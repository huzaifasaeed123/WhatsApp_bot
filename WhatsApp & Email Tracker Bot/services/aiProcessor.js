// services/aiProcessor.js
require('dotenv').config();
const OpenAI = require('openai');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Analyze a WhatsApp message using GPT to extract logistics data.
 * @param {string} messageText - The WhatsApp message text
 * @returns {Promise<Array>} Extracted logistics data in JSON array format
 */
async function analyzeMessage(messageText) {
  try {
    const prompt = `
You are an intelligent logistics data extractor AI.

Your job is to carefully read the given message and extract structured information
related to truck shipments, transport offers, or load details.

For each shipment mentioned in the message, return an item in a JSON array.

Each item must strictly have these fields:
{
  "LoadingCountry": string or null,
  "LoadingCity": string or null,
  "LoadingPostcode": string or null,    // e.g., LF7, 10115, etc.
  "DeliveryCountry": string or null,
  "DeliveryCity": string or null,
  "DeliveryPostcode": string or null,
  "Price": string or null,
  "Comments": string or null,           // only descriptive text like "READY TO LOAD"
  "Sold": boolean
}

Rules:
- Detect "SOLD" (case-insensitive, may appear as ❌SOLD❌, SOLD, or similar) → Sold = true
- Extract all numeric or currency prices (e.g. "€700", "2000 EUR", "1500€")
- Country is the emoji flag or derived from the city if possible (e.g. 🇩🇪 → Germany)
- Postal codes may appear next to the city or in the text (e.g., "LF7", "10115 Berlin") — extract them into LoadingPostcode and DeliveryPostcode
- Do NOT include postal codes in Comments
- Comments are any other relevant descriptive text like "READY TO LOAD", "URGENT", etc.
- If no shipment info is found, return an empty JSON array: []

⚠️ Output format rules:
- Respond with ONLY valid JSON.
- Do not include markdown formatting (no triple backticks, no explanations, no text).
- Do not wrap output inside code blocks.

Now analyze this message and return valid JSON.

Message:
"""
${messageText}
"""
`;


    // 🧠 Send to GPT
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // or 'gpt-3.5-turbo' if you want cheaper
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });

    // 🧩 Extract raw text output
    let content = completion.choices[0].message.content.trim();

    // 🧹 Clean markdown formatting if GPT returned ```json ... ```
    const cleaned = content
      .replace(/^```json\s*/i, '')
      .replace(/^```/, '')
      .replace(/```$/, '')
      .trim();

    // 🧾 Parse JSON safely
    try {
      const data = JSON.parse(cleaned);
      if (Array.isArray(data)) {
        return data;
      } else {
        console.warn('⚠️ AI did not return an array:', cleaned);
        return [];
      }
    } catch (err) {
      console.error('❌ JSON parsing failed:', cleaned);
      return [];
    }
  } catch (error) {
    console.error('AI processing failed:', error.message);
    return [];
  }
}

module.exports = { analyzeMessage };
