
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

export interface StreamResult {
  chunk: string;
  isDone: boolean;
  type: MessageType;
}

export const streamUserMessage = async (
  message: string, 
  onChunk: (text: string, type: MessageType) => void
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
  
  try {
    const streamResponse = await ai.models.generateContentStream({
      model: 'gemini-3-flash-preview',
      contents: message,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.1,
        // Disable thinking to minimize latency for "Fast" response requirement
        thinkingConfig: { thinkingBudget: 0 }
      },
    });

    let fullText = "";
    let detectedType: MessageType = 'general';

    for await (const chunk of streamResponse) {
      const chunkText = chunk.text;
      fullText += chunkText;

      // Check for log marker in the growing text
      if (fullText.includes("[[LOG_ISSUE:")) {
        detectedType = 'community_logged';
      }

      // Clean the text for display (remove marker if detected)
      const displayContent = fullText.replace(/\[\[LOG_ISSUE:.*?\]\]/, "").trim();
      onChunk(displayContent, detectedType);
    }
  } catch (error) {
    console.error("Gemini Streaming Error:", error);
    onChunk("An error occurred while communicating with the AI. Please try again.", 'general');
  }
};
