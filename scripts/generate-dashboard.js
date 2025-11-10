import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAI } from 'openai';
import { z } from 'zod';
import { MEAL_BREAKDOWN_PROMPT, PICTURE_GENERATION_PROMPT } from './prompts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const INPUT_PATH = path.join(ROOT_DIR, 'data', 'input.json');
const OUTPUT_DATA_PATH = path.join(ROOT_DIR, 'public', 'data', 'dashboard-data.json');
const GENERATED_DIR = path.join(ROOT_DIR, 'public', 'generated');

const REQUIRED_ENV = ['OPENAI_API_KEY'];

function ensureEnv() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        `Set them before running the generator.`
    );
  }
}

const mealBreakdownSchema = {
  name: 'meal_breakdown',
  schema: {
    type: 'object',
    properties: {
      vegFruit: { type: 'number', description: 'Percent Veg & Fruit (0-100).' },
      healthyCarbs: { type: 'number', description: 'Percent Healthy Carbs (0-100).' },
      protein: { type: 'number', description: 'Percent Protein (0-100).' },
      pauseFood: { type: 'number', description: 'Percent Pause Food (0-100).' },
      summary: { type: 'string', description: '1-2 sentences summarizing the reasoning.' },
      adjustmentTips: {
        type: 'string',
        description: 'Specific tip for balancing the meal closer to Fuel foods.'
      }
    },
    required: ['vegFruit', 'healthyCarbs', 'protein', 'pauseFood', 'summary', 'adjustmentTips'],
    additionalProperties: false
  }
};

const MealBreakdownResult = z.object({
  vegFruit: z.number().min(0).max(100),
  healthyCarbs: z.number().min(0).max(100),
  protein: z.number().min(0).max(100),
  pauseFood: z.number().min(0).max(100),
  summary: z.string(),
  adjustmentTips: z.string()
});

const PALETTE = {
  vegFruit: '#4fa742',
  healthyCarbs: '#f5d957',
  protein: '#f59f1a',
  pauseFood: '#f2899a',
  neutral: '#d2d2d2',
  canvasBg: '#ffffff'
};

function buildDataUrl(base64, mimeType = 'image/png') {
  if (!base64) return '';
  return `data:${mimeType};base64,${base64}`;
}

function extractJsonSchemaOutput(response) {
  if (!response) return null;
  const outputs = Array.isArray(response.output) ? response.output : [];
  for (const item of outputs) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const content of contents) {
      if (content?.type === 'output_json' && content.json) {
        return content.json;
      }
      if (content?.type === 'json_schema' && content.json) {
        return content.json;
      }
      if (content?.type === 'output_text' && content.text) {
        const text =
          Array.isArray(content.text) && content.text.length
            ? content.text.join('')
            : String(content.text ?? '');
        if (text.trim()) {
          try {
            return JSON.parse(text);
          } catch (error) {
            console.warn('Unable to parse output_text as JSON', error);
          }
        }
      }
    }
  }
  if (Array.isArray(response.output_text) && response.output_text.length) {
    const joined = response.output_text.join('').trim();
    if (joined) {
      try {
        return JSON.parse(joined);
      } catch (error) {
        console.warn('Unable to parse output_text array as JSON', error);
      }
    }
  } else if (typeof response.output_text === 'string' && response.output_text.trim()) {
    try {
      return JSON.parse(response.output_text);
    } catch (error) {
      console.warn('Unable to parse output_text string as JSON', error);
    }
  }
  return null;
}

function resolveSourcePath(source) {
  if (source.type !== 'image') {
    return null;
  }

  if (!source.path) {
    throw new Error('Image source requires a path property.');
  }

  return path.isAbsolute(source.path) ? source.path : path.join(ROOT_DIR, source.path);
}

function lookupMimeType(filePath, fallback = 'image/png') {
  if (filePath?.endsWith('.png')) return 'image/png';
  if (filePath?.endsWith('.jpg') || filePath?.endsWith('.jpeg')) return 'image/jpeg';
  if (filePath?.endsWith('.webp')) return 'image/webp';
  return fallback;
}

async function encodeImage(source) {
  if (source.type !== 'image') {
    return null;
  }
  const resolvedPath = resolveSourcePath(source);
  const fileBuffer = await readFile(resolvedPath);
  return {
    data: fileBuffer.toString('base64'),
    mimeType: source.mimeType ?? lookupMimeType(resolvedPath)
  };
}

function buildUserContent({ title, source, additional }) {
  const segments = [];
  const descriptionLines = [];
  if (title) {
    descriptionLines.push(`Title: ${title}`);
  }

  if (source.type === 'text') {
    descriptionLines.push(`Kid meal description: ${source.value}`);
  } else {
    descriptionLines.push('Kid meal photo is attached.');
    if (source.caption) {
      descriptionLines.push(`Caption: ${source.caption}`);
    }
  }

  if (additional) {
    descriptionLines.push(additional);
  }

  segments.push({ type: 'input_text', text: descriptionLines.join('\n') });
  return segments;
}

async function callMealBreakdown(openai, meal) {
  const baseContent = buildUserContent({
    title: meal.title,
    source: meal.source
  });
  const imagePayload = await encodeImage(meal.source);
  const userContent = [...baseContent];

  if (imagePayload) {
    userContent.push({
      type: 'input_image',
      image_url: buildDataUrl(imagePayload.data, imagePayload.mimeType)
    });
  }

  const response = await openai.responses.create({
    model: 'gpt-4.1-mini',
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: MEAL_BREAKDOWN_PROMPT }]
      },
      {
        role: 'user',
        content: userContent
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: mealBreakdownSchema.name,
    schema: {
      ...mealBreakdownSchema.schema,
      required: Array.from(new Set([...(mealBreakdownSchema.schema.required ?? [])])),
      strict: true
    }
  }
    }
  });

  const parsed = extractJsonSchemaOutput(response);
  if (!parsed) {
    throw new Error(`Meal breakdown returned no output for meal ${meal.id}`);
  }

  const result = MealBreakdownResult.parse(parsed);

  const total = result.vegFruit + result.healthyCarbs + result.protein + result.pauseFood;
  if (Math.abs(total - 100) > 0.5) {
    console.warn(
      `Warning: Percentages for ${meal.title ?? meal.id} sum to ${total}. Adjusting proportionally.`
    );
    const scale = 100 / total;
    result.vegFruit = Math.round(result.vegFruit * scale * 10) / 10;
    result.healthyCarbs = Math.round(result.healthyCarbs * scale * 10) / 10;
    result.protein = Math.round(result.protein * scale * 10) / 10;
    result.pauseFood = Math.round(result.pauseFood * scale * 10) / 10;
  }

  return result;
}

function buildPicturePrompt({ meal, breakdown }) {
  const pauseShare = breakdown.pauseFood;
  const backgroundGuide =
    pauseShare < 10
      ? 'The background should be green because Pause foods are <10%.'
      : pauseShare <= 50
        ? 'Use a yellow/orange background because Pause foods are between 10% and 50%.'
        : 'Use a light red/pink background because Pause foods are over 50%.';

  const description =
    meal.source.type === 'text'
      ? meal.source.value
      : meal.source.caption ?? 'Use the attached meal photo as inspiration.';

  return `${PICTURE_GENERATION_PROMPT}

Meal title: ${meal.title ?? 'Meal'}
${backgroundGuide}
Include plate styling that references: Veg & Fruit ${breakdown.vegFruit}%, Healthy Carbs ${breakdown.healthyCarbs}%, Protein ${breakdown.protein}%, Pause Food ${breakdown.pauseFood}%.
Core meal notes: ${description}
`;
}

async function callPictureGeneration(openai, meal, breakdown) {
  const prompt = buildPicturePrompt({ meal, breakdown });
  const imagePayload = await encodeImage(meal.source);
  const userContent = [
    {
      type: 'input_text',
      text: prompt
    }
  ];

  if (imagePayload) {
    userContent.push({
      type: 'input_image',
      image_url: buildDataUrl(imagePayload.data, imagePayload.mimeType)
    });
  }

  const response = await openai.responses.create({
    model: 'gpt-4.1-mini',
    modalities: ['text', 'image'],
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text:
              'You transform kids meals into stylized 4:5 ratio photos. Follow the brand guide and produce a single polished photo, no captions.'
          }
        ]
      },
      {
        role: 'user',
        content: userContent
      }
    ]
  });

  for (const item of response.output ?? []) {
    if (!item.content) continue;
    for (const content of item.content) {
      if (content.type === 'output_image') {
        const imageData =
          content.image?.base64 ?? content.image_base64 ?? content.image?.data ?? null;
        if (imageData) {
          return imageData;
        }
      }
    }
  }

  throw new Error(`No image generated for meal ${meal.id}`);
}

function aggregateDay(day) {
  const totals = { vegFruit: 0, healthyCarbs: 0, protein: 0, pauseFood: 0 };
  if (!day.meals.length) {
    return totals;
  }
  for (const meal of day.meals) {
    totals.vegFruit += meal.breakdown.vegFruit;
    totals.healthyCarbs += meal.breakdown.healthyCarbs;
    totals.protein += meal.breakdown.protein;
    totals.pauseFood += meal.breakdown.pauseFood;
  }
  totals.vegFruit = Math.round((totals.vegFruit / day.meals.length) * 10) / 10;
  totals.healthyCarbs = Math.round((totals.healthyCarbs / day.meals.length) * 10) / 10;
  totals.protein = Math.round((totals.protein / day.meals.length) * 10) / 10;
  totals.pauseFood = Math.round((totals.pauseFood / day.meals.length) * 10) / 10;
  return totals;
}

async function saveImage(base64, targetPath) {
  const buffer = Buffer.from(base64, 'base64');
  await writeFile(targetPath, buffer);
}

async function main() {
  ensureEnv();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const rawInput = await readFile(INPUT_PATH, 'utf-8');
  const config = JSON.parse(rawInput);

  if (!config.days || !Array.isArray(config.days) || !config.days.length) {
    console.warn('No days provided in data/input.json. Nothing to generate.');
    return;
  }

  await mkdir(GENERATED_DIR, { recursive: true });

  const enrichedDays = [];
  for (const day of config.days) {
    const enrichedMeals = [];
    for (const meal of day.meals ?? []) {
      console.log(`Analyzing ${day.label ?? 'Day'} - ${meal.title ?? meal.id}...`);
      const breakdown = await callMealBreakdown(openai, meal);
      let generatedImageFile = null;
      if (config.generateImages !== false) {
        console.log(`Generating styled plate image for ${meal.title ?? meal.id}...`);
        const base64 = await callPictureGeneration(openai, meal, breakdown);
        const slug = `${meal.id ?? `${day.label ?? 'day'}-${enrichedMeals.length + 1}`}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
        const filename = `${slug || `meal-${Date.now()}`}.png`;
        const outPath = path.join(GENERATED_DIR, filename);
        await saveImage(base64, outPath);
        generatedImageFile = path.relative(path.join(ROOT_DIR, 'public'), outPath);
      }

      enrichedMeals.push({
        ...meal,
        breakdown,
        generatedImageFile
      });
    }
    enrichedDays.push({
      ...day,
      meals: enrichedMeals,
      summary: aggregateDay({ meals: enrichedMeals })
    });
  }

  const dashboardData = {
    generatedAt: new Date().toISOString(),
    palette: PALETTE,
    clientName: config.clientName ?? 'Student',
    weekLabel: config.weekLabel ?? 'tracked meals',
    startDate: config.startDate,
    days: enrichedDays
  };

  await mkdir(path.dirname(OUTPUT_DATA_PATH), { recursive: true });
  await writeFile(OUTPUT_DATA_PATH, JSON.stringify(dashboardData, null, 2));
  console.log(`Dashboard data saved to ${path.relative(ROOT_DIR, OUTPUT_DATA_PATH)}`);
}

main().catch((error) => {
  console.error('Failed to generate dashboard:', error);
  process.exitCode = 1;
});
