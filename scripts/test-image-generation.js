import assert from 'node:assert/strict';
import { callPictureGeneration } from './generate-dashboard.js';

const SAMPLE_BREAKDOWN = {
  vegFruit: 25,
  healthyCarbs: 25,
  protein: 25,
  pauseFood: 25
};

const SAMPLE_IMAGE = '00668454-Slice-of-New-York-City-Style-Cheese-Pizza-on-a-Paper-Plate.jpg';

function createStubClient(onInvoke) {
  return {
    responses: {
      create: async (payload) => onInvoke(payload)
    }
  };
}

async function testTextOnlyPrompt() {
  const requests = [];
  const client = createStubClient((payload) => {
    requests.push(payload);
    return {
      output: [
        {
          content: [
            {
              type: 'output_image',
              image: {
                base64: 'YmFzZTY0LWltYWdl',
                mimeType: 'image/png'
              }
            }
          ]
        }
      ]
    };
  });

  const meal = {
    id: 'text-meal',
    title: 'Text Meal',
    source: { type: 'text', value: 'Veggie wrap with carrots.' }
  };

  const result = await callPictureGeneration(client, meal, SAMPLE_BREAKDOWN);
  assert.equal(result.base64, 'YmFzZTY0LWltYWdl');
  assert.equal(result.mimeType, 'image/png');

  const request = requests[0];
  assert.equal(request.tool_choice.type, 'image_generation');
  assert.equal(request.tools[0].type, 'image_generation');
  assert.equal(request.tools[0].model, 'gpt-image-1');
  const userContent = request.input[1]?.content ?? [];
  assert.equal(userContent.length, 1, 'Expected only text content for text-only meals');
  assert.equal(userContent[0].type, 'input_text');
}

async function testImageReferencePrompt() {
  const requests = [];
  let downloadInvoked = false;
  const client = createStubClient((payload) => {
    requests.push(payload);
    return {
      output: [
        {
          content: [
            {
              type: 'output_image',
              image_url: { url: 'https://example.com/generated.png' },
              image: { mimeType: 'image/png' }
            }
          ]
        }
      ]
    };
  });

  const originalFetch = global.fetch;
  try {
    global.fetch = async (url) => {
      if (url === 'https://example.com/generated.png') {
        downloadInvoked = true;
        return {
          ok: true,
          headers: { get: () => 'image/png' },
          arrayBuffer: async () => Buffer.from('mock-image-bytes')
        };
      }
      throw new Error(`Unexpected fetch call to ${url}`);
    };

    const meal = {
      id: 'image-meal',
      title: 'Image Meal',
      source: {
        type: 'image',
        path: SAMPLE_IMAGE
      }
    };

    const result = await callPictureGeneration(client, meal, SAMPLE_BREAKDOWN);
    assert(downloadInvoked, 'Expected the image URL to be downloaded');
    assert.equal(
      Buffer.from('mock-image-bytes').toString('base64'),
      result.base64,
      'Downloaded base64 should match returned payload'
    );
    const content = requests[0]?.input?.[1]?.content ?? [];
    assert(
      content.some((part) => part.type === 'input_image'),
      'Image meals should include an input_image payload'
    );
  } finally {
    global.fetch = originalFetch;
  }
}

async function testImageGenerationCallPayload() {
  const client = createStubClient(() => ({
    output: [
      {
        id: 'ig-test',
        type: 'image_generation_call',
        status: 'completed',
        output_format: 'png',
        result: 'dGVzdC1nZW4tYmFzZTY0'
      }
    ]
  }));

  const meal = {
    id: 'image-call-meal',
    title: 'Generated Meal',
    source: { type: 'text', value: 'Toast with strawberries.' }
  };

  const result = await callPictureGeneration(client, meal, SAMPLE_BREAKDOWN);
  assert.equal(result.base64, 'dGVzdC1nZW4tYmFzZTY0');
  assert.equal(result.mimeType, 'image/png');
}

async function run() {
  await testTextOnlyPrompt();
  await testImageReferencePrompt();
  await testImageGenerationCallPayload();
  console.log('Image generation tool tests passed ✔');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
