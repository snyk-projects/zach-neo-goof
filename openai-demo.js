const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function askGPT() {
  return await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "user", content: "Hello" }
    ]
  });
}