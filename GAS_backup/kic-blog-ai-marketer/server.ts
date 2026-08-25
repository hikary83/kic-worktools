import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Robust retry wrapper for Gemini generateContent API calls
async function generateContentWithRetry(
  ai: any,
  params: { model: string; contents: any; config?: any },
  retries = 3
): Promise<any> {
  let modelToUse = params.model;
  let attempt = 1;

  while (attempt <= retries) {
    try {
      return await ai.models.generateContent({
        ...params,
        model: modelToUse,
      });
    } catch (err: any) {
      const errMsg = typeof err === "string" ? err : (err.message || JSON.stringify(err));
      const status = err.status || (err.error && err.error.code);
      
      const isTransient = 
        status === 503 || 
        status === 429 || 
        errMsg.includes("503") || 
        errMsg.includes("429") || 
        errMsg.includes("UNAVAILABLE") || 
        errMsg.includes("RESOURCE_EXHAUSTED") || 
        errMsg.includes("high demand") ||
        errMsg.includes("temp");

      if (isTransient) {
        if (attempt >= retries) {
          // Cascade fallback if we run out of retries on a specific model
          if (modelToUse === "gemini-3.5-flash") {
            console.warn(`gemini-3.5-flash is experiencing issues. Switching to fallback model gemini-2.5-flash...`);
            modelToUse = "gemini-2.5-flash";
            attempt = 1;
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
          } else if (modelToUse === "gemini-2.5-flash") {
            console.warn(`gemini-2.5-flash is experiencing issues. Switching to fallback model gemini-1.5-flash...`);
            modelToUse = "gemini-1.5-flash";
            attempt = 1;
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
          }
          throw err;
        }

        const delay = attempt * 1000;
        console.warn(`Gemini API transient issue on ${modelToUse} (Attempt ${attempt}/${retries}): ${errMsg.slice(0, 200)}. Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt++;
      } else {
        throw err;
      }
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '100mb' }));

  // API Route for Blog Generation
  app.post("/api/gemini/generate", async (req, res) => {
    const { contents, systemInstruction } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server GEMINI_API_KEY is not defined. Please check AI Studio Settings > Secrets." });
    }

    const ai = new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    try {
      const response = await generateContentWithRetry(ai, {
        model: "gemini-3.5-flash",
        contents,
        config: {
          systemInstruction,
        },
      });
      res.json({ text: response.text });
    } catch (err: any) {
      console.error("Gemini Error:", err);
      res.status(500).json({ error: err.message || "An error occurred during blog post generation." });
    }
  });

  // API Route for Assets Generation (3 Images & Hashtags)
  app.post("/api/gemini/generate-assets", async (req, res) => {
    const { blogPost, systemInstruction } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server GEMINI_API_KEY is not defined." });
    }

    const ai = new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    try {
      // 1. Generate Images
      const imgPromise = generateContentWithRetry(ai, {
        model: "gemini-3.5-flash",
        contents: `다음 블로그 포스팅 내용을 깊이 있게 분석하여, 본문의 특정 문맥이나 상황(예: 측정 현장, 장비 클로즈업, 분석 화면 등)이 잘 드러나는 완전히 각기 다른 구도의 고해상도 이미지 프롬프트 3개를 작성해줘. 
비슷한 이미지가 생성되지 않도록, 3장의 이미지가 담는 정보와 시각적 포커스(Wide, Close-up, Persona 중심 등)를 확연히 다르게 구성해줘.
(중요: 인물이 등장할 경우 반드시 한국인(Korean people, Korean engineers, etc.)으로 묘사되도록 작성할 것.)

포스팅 내용:
${blogPost}

반드시 아래 양식을 엄격히 지켜서 출력해줘:
[이미지 1]
* 프롬프트(EN): (영문 이미지 생성 프롬프트 - 구체적인 피사체, 조명, 구도 포함)
* 파일명: (영문파일명만 작성, .png 등 확장자 절대 제외)
* Alt 태그: (이미지 본문 역할 설명)
* 캡션: (이미지 하단에 표시될 한글 캡션)

[이미지 2]
... (동일하게 3개까지)`,
        config: { systemInstruction },
      });

      // 2. Generate Hashtags
      const hashPromise = generateContentWithRetry(ai, {
        model: "gemini-3.5-flash",
        contents: `다음 블로그 포스팅 내용에 어울리는 해시태그를 생성해줘.

[필수 포함 해시태그]
#검교정 #계측기교정 #캘리브레이션 #ISO17025 #KOLAS #교정기관 #코리아인스트루먼트 #KIC

위의 필수 해시태그를 반드시 포함하고, 추가로 포스팅 주제에 맞는 태그 5~10개를 더 생성해서 전체 해시태그 리스트를 출력해줘.
다른 설명이나 인사말 없이 오직 해시태그(#...)만 나열해줘.

포스팅 내용:
${blogPost}`,
        config: { systemInstruction },
      });

      const [imgResponse, hashResponse] = await Promise.all([imgPromise, hashPromise]);

      res.json({
        imagesText: imgResponse.text,
        hashtagsText: hashResponse.text
      });
    } catch (err: any) {
      console.error("Gemini Error:", err);
      res.status(500).json({ error: err.message || "An error occurred during assets generation." });
    }
  });

  // API Route for More Images Description Generation
  app.post("/api/gemini/generate-more-assets", async (req, res) => {
    const { blogPost, currentCount, systemInstruction } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server GEMINI_API_KEY is not defined." });
    }

    const ai = new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    try {
      const imgResponse = await generateContentWithRetry(ai, {
        model: "gemini-3.5-flash",
        contents: `다음 블로그 포스팅 내용을 깊이 있게 분석하여, 기존 내용과 중복되지 않는 새로운 추가 이미지 프롬프트 3개를 작성해줘. 
각 프롬프트는 본문에서 아직 시각화되지 않은 디테일이나 완전히 새로운 구도를 제안해야 해.
(중요: 이미지 프롬프트에 인물이 등장할 경우, 반드시 한국인(Korean people, Korean engineers, etc.)으로 묘사되도록 작성해줘.)

포스팅 내용:
${blogPost}

출력 양식:
[이미지 ${currentCount + 1} - 추가]
* 프롬프트(EN): (상세한 영문 프롬프트)
* 파일명: (...확장자 제외)
* Alt 태그: ...
* 캡션: ...
(이미지 ${currentCount + 2}, ${currentCount + 3}도 동일하게)`,
        config: { systemInstruction },
      });

      res.json({ imagesText: imgResponse.text });
    } catch (err: any) {
      console.error("Gemini Error:", err);
      res.status(500).json({ error: err.message || "An error occurred during additional image generation." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
