import OpenAI from 'openai';
import { config } from 'dotenv';

// Load environment variables
config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function getAIResponse(messages) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
      stream: true
    });

    let fullResponse = '';
    
    for await (const chunk of completion) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
      }
    }

    return {
      success: true,
      content: fullResponse
    };
  } catch (error) {
    console.error('AI Response Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
} 