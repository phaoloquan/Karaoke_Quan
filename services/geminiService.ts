
import { GoogleGenAI, Type } from "@google/genai";
import { LyricLine } from "../types";

export const getLyricsFromAudio = async (audioBase64: string): Promise<LyricLine[]> => {
  // Khởi tạo instance ngay trong hàm để đảm bảo luôn lấy được API_KEY mới nhất từ môi trường Netlify
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: "audio/mp3",
                data: audioBase64,
              },
            },
            {
              text: "Hãy nghe đoạn âm thanh này và trích xuất lời bài hát (lyrics) kèm theo mốc thời gian (timestamp tính bằng giây). Trả về dưới dạng mảng JSON các đối tượng có thuộc tính 'time' (số giây) và 'text' (nội dung lời). Ví dụ: [{\"time\": 0, \"text\": \"Lời mở đầu\"}, ...]",
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              time: { type: Type.NUMBER },
              text: { type: Type.STRING },
            },
            required: ["time", "text"],
          },
        },
      },
    });

    const lyricsJson = JSON.parse(response.text || "[]");
    return lyricsJson as LyricLine[];
  } catch (error) {
    console.error("Error fetching lyrics from Gemini:", error);
    return [];
  }
};
