
import { GoogleGenAI } from "@google/genai";
import { MessageType } from "../types.ts";

const SYSTEM_INSTRUCTION = `
You are the Intelligence Layer for VDM AI. Your goal is to act as a Smart Router.

### CORE LOGIC:
- GENERAL: Personal inquiries, factual questions, personal advice.
- COMMUNITY PROBLEM: Issues affecting infrastructure, public safety, or public health.

### RULES:
1. If the user reports a COMMUNITY PROBLEM, you MUST trigger a log.
2. To trigger a log, start your response with: [[LOG_ISSUE: <category>]]
3. Provide a professional and empathetic response after the marker.

### FORMAT:
- General: "Your answer here..."
- Community: "[[LOG_ISSUE: <Category>]] I have officially logged this community concern."
`;

export const streamUserMessage = async (
  message: string, 
  onChunk: (text: string, type: MessageType) => void
) => {
  // Use process.env.API_KEY directly as per SDK guidelines.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const streamResponse = await ai.models.generateContentStream({
      model: 'gemini-3-flash-preview',
      contents: message,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 0 }
      },
    });

    let fullText = "";
    let detectedType: MessageType = 'general';

    for await (const chunk of streamResponse) {
      // Accessing the text property directly (not a method). 
      // It returns string | undefined, so we handle undefined.
      const chunkText = chunk.text || "";
      fullText += chunkText;

      if (fullText.includes("[[LOG_ISSUE:")) {
        detectedType = 'community_logged';
      }

      // Clean the text for display (remove marker if detected)
      const displayContent = fullText.replace(/\[\[LOG_ISSUE:.*?\]\]/g, "").trim();
      onChunk(displayContent, detectedType);
    }
  } catch (error) {
    console.error("Gemini Streaming Error:", error);
    onChunk("Communication error. Please check your connection or API key.", 'general');
  }
};
