/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Copy, 
  Check, 
  Image as ImageIcon, 
  Hash, 
  FileText, 
  RefreshCw, 
  ChevronRight, 
  AlertCircle,
  Settings,
  ArrowLeft,
  Download,
  Paperclip,
  X,
  File
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// --- Types ---

enum Step {
  INPUT = 1,
  GENERATION = 2,
  REFINEMENT = 3,
  ASSETS = 4
}

interface ImageAsset {
  id: number;
  type: string;
  prompt: string;
  filename: string;
  alt: string;
  caption: string;
}

// --- Constants ---

const SYSTEM_INSTRUCTION = `
당신은 B2B 산업용 계측기 및 교정 전문 기업 '코리아인스트루먼트(KIC)'의 네이버 블로그 포스팅을 전담하는 최고 수준의 AI 마케터 및 전문 엔지니어입니다.

[시각적 스타일 가이드 - 제공된 이미지 스타일 준수]
1. 블로그 제목: 포스팅의 가장 첫 줄에 [제목: 블로그 제목] 형식으로 매력적인 제목을 작성하십시오.
2. 섹션 제목 구성: 각 섹션은 반드시 ### (H3) 태그를 사용하여 "### 1. [제목] [이모지]", "### 2. [제목] [이모지]"와 같이 순차적인 번호 형식을 사용합니다. (예: ### 1. 똑똑한 자동 인식, 'Smart-plus' 모듈 시스템 🧠)
3. 번호 매기기: 모든 소제목(섹션 제목)은 1부터 시작하여 1씩 증가하며 중복되거나 1로 고정되지 않도록 주의하십시오.
4. 불렛 포인트: 주요 특징이나 설명은 반드시 '✔️' 또는 '✅' 이모지를 사용하여 나열합니다. (언더바(_)나 별표(*)를 불렛 포인트 기호로 사용하지 마십시오.)
5. 팁/참고 섹션: 추가 설명이나 보상(Compensation) 팁은 '💡 [제목]: [내용]' 형식을 사용합니다.
6. 줄바꿈: 문장 사이와 섹션 사이에는 충분한 여백(빈 줄 2개 이상)을 두어 모바일에서도 읽기 편하게 작성합니다.
7. 강조: 중요한 키워드나 문구는 반드시 마크다운의 굵게 기호(**텍스트**)를 사용하여 강조합니다. (예: **핵심 키워드**)
8. 표(Table): 마크다운 표 형식을 사용하여 데이터를 정리하십시오. (예: | 항목 | 내용 |)
9. 이미지 캡션: 모든 이미지 캡션은 내용과 어울리는 이모지로 시작하십시오. (예: 📷 [내용], 🔬 [내용] 등)
10. 리스트 기호 주의: 섹션 제목(소제목)을 작성할 때 마크다운 리스트 기호(1., 2., 3. 등)를 단독으로 사용하지 마십시오. 반드시 ### 기호와 함께 사용하여 헤더로 만드십시오. (예: ### 1. 제목)

[본문 내용 강화 가이드]
1. 전문성: 단순 제품 소개를 넘어 해당 기술의 원리(예: 피토관의 동압/정압 원리)를 엔지니어 관점에서 상세히 설명합니다.
2. 사례(Case Study): 해당 장비나 솔루션이 실제 현장(반도체 라인, 제약 클린룸, 발전소 등)에서 어떻게 문제 해결에 기여했는지 구체적인 사례를 포함합니다.
3. 도표(Table): 장비 사양 비교, 교정 주기 가이드, 오차 범위 등을 나타내는 마크다운 표를 반드시 1개 이상 포함하여 전문성을 높입니다.
4. KIC 솔루션: KIC만의 차별화된 교정 서비스(KOLAS 인증, 현장 교정 등)를 본문 내용과 연결하여 자연스럽게 제안합니다.

[출력 형식]
- 블로그 본문은 마크다운 형식으로 작성하되, 네이버 블로그 에디터 호환성을 위해 다음 규칙을 엄격히 따르십시오.
- **기울임꼴 절대 금지**: 언더바(_)나 별표(*)를 사용하여 텍스트를 기울임꼴(Italic)로 만들지 마십시오. (예: _텍스트_, *텍스트* 사용 금지)
- **특수문자 금지**: 문장 앞이나 뒤에 불필요한 언더바(_)나 별표(*)를 붙이지 마십시오. 이는 네이버 블로그에서 기울임꼴로 오인될 수 있습니다.
- **전체 감싸기 금지**: 포스팅 전체를 언더바(_)나 별표(*)로 감싸지 마십시오.
- **마크다운 기호 최소화**: 굵게(**)를 제외한 다른 마크다운 기호(기울임, 취소선 등)는 절대 사용하지 마십시오.
- **굵게**: 강조가 필요한 경우에만 마크다운의 굵게 기호(**텍스트**)를 사용하십시오.
- 코드 블록(\`\`\`)을 사용하지 마십시오.
- 이미지 삽입 위치는 📷 [이미지 1 삽입 위치], 📷 [이미지 2 삽입 위치]와 같이 순차적으로 표시하십시오.
- 문장 중간에 특수문자를 남발하지 마십시오.
`;

// --- Components ---

export default function App() {
  const [step, setStep] = useState<Step>(Step.INPUT);
  const [categories, setCategories] = useState<string[]>(() => {
    const saved = localStorage.getItem('kic_categories');
    return saved ? JSON.parse(saved) : [
      '01. 이론: 측정 이론 및 기초',
      '02. 솔루션: 교정 표준 솔루션',
      '03. 매뉴얼: 계측 장비 매뉴얼',
      '04. FAQ: 기술 지원 FAQ'
    ];
  });

  useEffect(() => {
    localStorage.setItem('kic_categories', JSON.stringify(categories));
  }, [categories]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [categoryToDelete, setCategoryToDelete] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [topic, setTopic] = useState('');
  const [blogPost, setBlogPost] = useState('');
  const [feedback, setFeedback] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedBlog, setCopiedBlog] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [copiedTags, setCopiedTags] = useState(false);
  const [copiedPromptId, setCopiedPromptId] = useState<number | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [imageAssets, setImageAssets] = useState<ImageAsset[]>([]);
  const [hashtags, setHashtags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<{ name: string; data: string; mimeType: string } | null>(null);

  const generatePost = async () => {
    if (!category || !topic) {
      setError('카테고리와 주제를 입력해주세요.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const contents: any[] = [
        {
          text: `카테고리: ${category}\n주제: ${topic}\n\n위 정보를 바탕으로 네이버 블로그 포스팅 초안을 작성해줘. 반드시 매력적인 [블로그 제목]을 포함해야 하며, 모든 소제목(섹션 제목)은 반드시 ### 1., ### 2., ### 3. 과 같이 순차적으로 번호를 매겨서 작성해줘. 절대 모든 번호를 1로 고정하지 마. ${attachedFile ? '첨부된 파일의 내용을 분석하여 매뉴얼 설명이나 관련 내용을 상세히 포함해줘.' : ''}`
        }
      ];

      if (attachedFile) {
        contents.push({
          inlineData: {
            data: attachedFile.data,
            mimeType: attachedFile.mimeType
          }
        });
      }

      setStep(Step.GENERATION);
      setBlogPost('');

      const res = await fetch("/api/gemini/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: { parts: contents },
          systemInstruction: SYSTEM_INSTRUCTION
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with status ${res.status}`);
      }

      const data = await res.json();
      setBlogPost(data.text || '');

    } catch (err: any) {
      console.error(err);
      setError(err.message || '포스팅 생성 중 오류가 발생했습니다.');
      if (!blogPost) setStep(Step.INPUT); // fallback to input if failed before starting
    } finally {
      setIsLoading(false);
    }
  };

  const refinePost = async () => {
    if (!feedback) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/gemini/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: `현재 포스팅 내용:\n${blogPost}\n\n사용자 피드백: ${feedback}\n\n피드백을 반영하여 포스팅을 수정해줘. 모든 소제목(섹션 제목)은 반드시 ### 1., ### 2., ### 3. 과 같이 순차적으로 번호를 매겨서 작성해야 함을 잊지 마세요. 절대 모든 번호를 1로 고정하지 마세요.`,
          systemInstruction: SYSTEM_INSTRUCTION
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with status ${res.status}`);
      }

      const data = await res.json();
      setBlogPost(data.text || '');
      setFeedback('');
    } catch (err: any) {
      console.error(err);
      setError(err.message || '포스팅 수정 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const generateAssets = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/gemini/generate-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blogPost,
          systemInstruction: SYSTEM_INSTRUCTION
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with status ${res.status}`);
      }

      const data = await res.json();
      const imgText = data.imagesText || '';
      const assets: ImageAsset[] = [];
      
      // Split by image blocks
      const imageBlocks = imgText.split(/\[이미지 \d\]/).filter((block: string) => block.trim().length > 10);
      
      imageBlocks.forEach((block: string, index: number) => {
        const promptMatch = block.match(/프롬프트\(EN\):\s*(.*)/i);
        const filenameMatch = block.match(/파일명:\s*(.*)/i);
        const altMatch = block.match(/Alt\s*태그:\s*(.*)/i);
        const captionMatch = block.match(/캡션:\s*(.*)/i);
        
        if (promptMatch) {
          assets.push({
            id: index + 1,
            type: index === 0 ? '메인' : '서브',
            prompt: promptMatch[1].trim(),
            filename: filenameMatch ? filenameMatch[1].trim().replace(/\.[^/.]+$/, "") : `image_${index + 1}`,
            alt: altMatch ? altMatch[1].trim() : 'KIC 블로그 이미지',
            caption: captionMatch ? captionMatch[1].trim().replace(/^["']+|["']+$/g, '') : ''
          });
        }
      });
      
      setImageAssets(assets);

      const essentialHashtags = "#검교정 #계측기교정 #캘리브레이션 #ISO17025 #KOLAS #교정기관 #코리아인스트루먼트 #KIC";
      let generatedText = data.hashtagsText || '';
      
      // Extract only hashtags from the response using regex
      const hashtagMatches = generatedText.match(/#[\w가-힣]+/g);
      let generatedHashtags = hashtagMatches ? hashtagMatches.join(' ') : generatedText;
      
      // Clean up markdown code blocks if any
      generatedHashtags = generatedHashtags.replace(/```text\n|```markdown\n|```/g, '').trim();
      
      // If the AI didn't include the essential ones, prepend them
      if (!generatedHashtags.includes('#검교정')) {
        generatedHashtags = `${essentialHashtags} ${generatedHashtags}`;
      }
      
      setHashtags(generatedHashtags);
      
      setStep(Step.ASSETS);
    } catch (err: any) {
      console.error(err);
      setError(err.message || '에셋 생성 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const generateMoreAssets = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const currentCount = imageAssets.length;

      const res = await fetch("/api/gemini/generate-more-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blogPost,
          currentCount,
          systemInstruction: SYSTEM_INSTRUCTION
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with status ${res.status}`);
      }

      const data = await res.json();
      const imgText = data.imagesText || '';
      const newAssets: ImageAsset[] = [];
      const sections = imgText.split(/\[이미지 \d+ - .*\]/).filter((s: string) => s.trim());
      
      sections.forEach((section: string, index: number) => {
        const lines = section.trim().split('\n');
        const asset: Partial<ImageAsset> = { id: currentCount + index + 1 };
        lines.forEach((line: string) => {
          if (line.includes('프롬프트(EN):')) asset.prompt = line.split('프롬프트(EN):')[1].trim();
          if (line.includes('파일명:')) asset.filename = line.split('파일명:')[1].trim().replace(/\.[^/.]+$/, "");
          if (line.includes('Alt 태그:')) asset.alt = line.split('Alt 태그:')[1].trim();
          if (line.includes('캡션:')) asset.caption = line.split('캡션:')[1].trim().replace(/^["']+|["']+$/g, '');
        });
        if (asset.prompt) newAssets.push({
          id: (asset.id as number),
          type: '서브',
          prompt: asset.prompt,
          filename: asset.filename || `image_${asset.id}`,
          alt: asset.alt || 'KIC 블로그 추가 이미지',
          caption: asset.caption || ''
        });
      });

      if (newAssets.length > 0) {
        setImageAssets([...imageAssets, ...newAssets]);
      } else {
        const lines = imgText.split('\n');
        const asset: Partial<ImageAsset> = { id: currentCount + 1, type: '서브' };
        lines.forEach((line: string) => {
          if (line.includes('프롬프트(EN):')) asset.prompt = line.split('프롬프트(EN):')[1].trim();
          if (line.includes('파일명:')) asset.filename = line.split('파일명:')[1].trim().replace(/\.[^/.]+$/, "");
          if (line.includes('Alt 태그:')) asset.alt = line.split('Alt 태그:')[1].trim();
          if (line.includes('캡션:')) asset.caption = line.split('캡션:')[1].trim().replace(/^["']+|["']+$/g, '');
        });
        if (asset.prompt) {
          setImageAssets([...imageAssets, asset as ImageAsset]);
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || '추가 에셋 생성 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string, type: 'text' | 'tags' | 'prompt' | 'filename' = 'text', id?: number, field?: string) => {
    // Extract content from markdown code block if present
    const match = text.match(/```markdown\n([\s\S]*?)\n```/) || text.match(/```text\n([\s\S]*?)\n```/);
    let cleanText = match ? match[1] : text;
    
    // Remove italics/bold markdown symbols to prevent slanted text issue (only for blog text/tags, preserve for filenames/prompts)
    if (type !== 'prompt' && type !== 'filename') {
      cleanText = cleanText
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1');
    }

    navigator.clipboard.writeText(cleanText);
    
    if (type === 'text') {
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    } else if (type === 'tags') {
      setCopiedTags(true);
      setTimeout(() => setCopiedTags(false), 2000);
    } else if (type === 'prompt' && id !== undefined) {
      if (field) {
        setCopiedField(`${id}-${field}`);
        setTimeout(() => setCopiedField(null), 2000);
      } else {
        setCopiedPromptId(id);
        setTimeout(() => setCopiedPromptId(null), 2000);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = (event.target?.result as string).split(',')[1];
      setAttachedFile({
        name: file.name,
        data: base64,
        mimeType: file.type || 'application/octet-stream'
      });
    };
    reader.readAsDataURL(file);
  };

  const removeFile = () => {
    setAttachedFile(null);
  };

  const copyRichText = async (elementId: string) => {
    const element = document.getElementById(elementId);
    if (!element) return;

    try {
      // Get the rendered HTML
      let html = element.innerHTML;
      
      // Naver Blog's editor prefers simpler HTML with inline styles for bolding.
      // We ensure all <strong> and <b> tags are clean and have explicit bold styling.
      // We explicitly REMOVE italics (em, i, blockquote, cite) to prevent the "slanted text" issue reported by users.
      // We also add font-style: normal to all elements to be absolutely sure.
      html = html
        .replace(/<strong>/g, '<b style="font-weight: bold; font-style: normal;">')
        .replace(/<\/strong>/g, '</b>')
        .replace(/<em>/g, '<span style="font-style: normal;">')
        .replace(/<\/em>/g, '</span>')
        .replace(/<i>/g, '<span style="font-style: normal;">')
        .replace(/<\/i>/g, '</span>')
        .replace(/<blockquote[^>]*>/g, '<div style="font-style: normal; border-left: 4px solid #eee; padding-left: 1em; margin: 1em 0;">')
        .replace(/<\/blockquote>/g, '</div>')
        .replace(/<cite[^>]*>/g, '<span style="font-style: normal;">')
        .replace(/<\/cite>/g, '</span>')
        // Sometimes markdown markers survive if parsing fails, let's clean them manually in HTML
        .replace(/\*\*([^*]+)\*\*/g, '<b style="font-weight: bold; font-style: normal;">$1</b>')
        .replace(/_([^_]+)_/g, '$1') // Remove single underscores (italics)
        .replace(/\*([^*]+)\*/g, '$1') // Remove single asterisks (italics)
        // Aggressively remove any remaining markdown italics markers outside of HTML tags
        .replace(/(<[^>]+>)|[_*]/g, (match, tag) => tag || '')
        .replace(/<p>/g, '<p style="margin-bottom: 1.5em; line-height: 1.8; font-style: normal;">')
        .replace(/<h[1-6]>/g, (match) => `<${match.slice(1, 3)} style="font-weight: bold; font-style: normal; margin-top: 2em; margin-bottom: 1em; font-size: 1.25em; color: #000;">`)
        .replace(/<\/h[1-6]>/g, (match) => `</${match.slice(2, 4)}>`);

      // Create a plain text version without any markdown symbols
      const text = element.innerText
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/✔️|✅|💡|📷|🔬/g, (match) => match + ' '); // Add spacing for emojis if needed
      
      // Wrap in a div with font-style: normal to be absolutely sure Naver Blog doesn't apply italics
      html = `<div style="font-style: normal !important;">${html}</div>`;
      
      const blobHtml = new Blob([html], { type: 'text/html' });
      const blobText = new Blob([text], { type: 'text/plain' });
      
      const data = [new ClipboardItem({
        'text/html': blobHtml,
        'text/plain': blobText,
      })];
      
      await navigator.clipboard.write(data);
      
      setCopiedBlog(true);
      setTimeout(() => setCopiedBlog(false), 2000);
    } catch (err) {
      console.error('Failed to copy rich text:', err);
      // Fallback to plain text copy if rich text fails
      copyToClipboard(blogPost, 'text');
    }
  };

  const addCategory = () => {
    if (newCategory.trim() && !categories.includes(newCategory.trim())) {
      setCategories([...categories, newCategory.trim()]);
      setNewCategory('');
    }
  };

  const removeCategory = (cat: string) => {
    setCategories(categories.filter(c => c !== cat));
    if (category === cat) setCategory('');
    setCategoryToDelete(null);
  };

  const startEditing = (cat: string) => {
    setEditingCategory(cat);
    setEditingValue(cat);
  };

  const saveEdit = () => {
    if (editingCategory && editingValue.trim() && editingCategory !== editingValue.trim()) {
      const newCategories = categories.map(c => c === editingCategory ? editingValue.trim() : c);
      setCategories(newCategories);
      if (category === editingCategory) setCategory(editingValue.trim());
    }
    setEditingCategory(null);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans selection:bg-[#E6E6E6]">
      {/* Header */}
      <header className="bg-white border-b border-black/5 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
              <Settings className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">KIC Blog AI Marketer</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-xs font-medium text-black/40 uppercase tracking-widest">
              <span className={step >= 1 ? 'text-black' : ''}>Input</span>
              <ChevronRight className="w-3 h-3" />
              <span className={step >= 2 ? 'text-black' : ''}>Draft</span>
              <ChevronRight className="w-3 h-3" />
              <span className={step >= 4 ? 'text-black' : ''}>Assets</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {step === Step.INPUT && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto space-y-8"
            >
              <div className="space-y-2">
                <h2 className="text-3xl font-light tracking-tight">새로운 포스팅 시작하기</h2>
                <p className="text-black/50">카테고리와 주제를 입력하면 KIC 전문 마케터가 초안을 작성합니다.</p>
              </div>

              <div className="space-y-6 bg-white p-8 rounded-2xl shadow-sm border border-black/5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-black/40">카테고리</label>
                    <button 
                      onClick={() => setIsSettingsOpen(true)}
                      className="p-1 hover:bg-black/5 rounded-md transition-colors text-black/40 hover:text-black"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </div>
                  <select 
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-[#F9F9F9] border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-black/5 transition-all outline-none"
                  >
                    <option value="">카테고리 선택</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-black/40">주제 및 내용</label>
                    {topic && (
                      <button 
                        onClick={() => setTopic('')}
                        className="p-1 text-black/20 hover:text-red-500 transition-colors"
                        title="내용 초기화"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <textarea 
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="포스팅할 주제나 매뉴얼 내용을 입력해주세요..."
                    className="w-full bg-[#F9F9F9] border-none rounded-xl px-4 py-3 h-48 focus:ring-2 focus:ring-black/5 transition-all outline-none resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-black/40">참고 파일 (선택)</label>
                  {!attachedFile ? (
                    <div className="relative group">
                      <input
                        type="file"
                        onChange={handleFileChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        accept=".pdf,.doc,.docx,.txt"
                      />
                      <div className="w-full bg-[#F9F9F9] border-2 border-dashed border-black/5 rounded-xl px-4 py-6 flex flex-col items-center justify-center gap-2 group-hover:border-black/10 transition-all">
                        <Paperclip className="w-5 h-5 text-black/20" />
                        <p className="text-xs text-black/40">매뉴얼 PDF, Word 또는 텍스트 파일 업로드</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between bg-black text-white px-4 py-3 rounded-xl">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <File className="w-4 h-4 flex-shrink-0" />
                        <span className="text-xs font-medium truncate">{attachedFile.name}</span>
                      </div>
                      <button 
                        onClick={removeFile}
                        className="p-1 hover:bg-white/20 rounded-lg transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 p-3 rounded-lg">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                  </div>
                )}

                <button
                  onClick={generatePost}
                  disabled={isLoading}
                  className="w-full bg-black text-white rounded-xl py-4 font-bold flex items-center justify-center gap-2 hover:bg-black/90 transition-all disabled:opacity-50"
                >
                  {isLoading ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      포스팅 생성하기
                      <ChevronRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {(step === Step.GENERATION || step === Step.REFINEMENT) && (
            <motion.div
              key="generation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              {/* Left: Preview */}
              <div className="lg:col-span-2 space-y-6">
                {error && (
                  <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 p-3 rounded-lg">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <button 
                    onClick={() => setStep(Step.INPUT)}
                    className="flex items-center gap-2 text-sm font-medium text-black/40 hover:text-black transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    처음으로
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => copyRichText('blog-preview-content')}
                      className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg text-sm font-bold hover:bg-black/90 transition-all shadow-lg shadow-black/10"
                    >
                      {copiedBlog ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copiedBlog ? '복사됨' : '블로그용 복사'}
                    </button>
                    <button
                      onClick={() => copyToClipboard(blogPost, 'text')}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-black/5 rounded-lg text-sm font-bold hover:bg-black hover:text-white transition-all"
                    >
                      {copiedText ? <Check className="w-4 h-4 text-green-500" /> : <FileText className="w-4 h-4" />}
                      {copiedText ? '복사됨' : '텍스트만 복사'}
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-black/5 overflow-hidden">
                  <div className="p-4 border-b border-black/5 bg-[#F9F9F9] flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-widest text-black/40">Draft Preview</span>
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-400/20" />
                      <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/20" />
                      <div className="w-2.5 h-2.5 rounded-full bg-green-400/20" />
                    </div>
                  </div>
                  <div id="blog-preview-content" className="p-8 max-h-[70vh] overflow-y-auto prose prose-sm max-w-none">
                    {blogPost ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {blogPost
                          .replace(/```[a-z]*\n|```/g, '') // Remove any code blocks
                          .replace(/\*\* \s*([^*]+)\s* \*\*/g, '**$1**') // Fix spaces inside **
                        }
                      </ReactMarkdown>
                    ) : isLoading ? (
                      <div className="space-y-4 animate-pulse py-4">
                        <div className="h-8 bg-black/5 rounded-md w-3/4" />
                        <div className="h-4 bg-black/5 rounded-md w-1/2" />
                        <div className="space-y-2 pt-6">
                          <div className="h-4 bg-black/5 rounded-md w-full" />
                          <div className="h-4 bg-black/5 rounded-md w-full" />
                          <div className="h-4 bg-black/5 rounded-md w-5/6" />
                        </div>
                        <div className="space-y-2 pt-4">
                          <div className="h-4 bg-black/5 rounded-md w-full" />
                          <div className="h-4 bg-black/5 rounded-md w-4/5" />
                        </div>
                        <div className="space-y-2 pt-4">
                          <div className="h-4 bg-black/5 rounded-md w-full" />
                          <div className="h-4 bg-black/5 rounded-md w-full" />
                        </div>
                      </div>
                    ) : (
                      <div className="text-black/30 text-xs py-10 text-center">작성된 포스팅 내용이 없습니다.</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: Refinement & Action */}
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-black/5 space-y-6">
                  <div className="space-y-2">
                    <h3 className="font-bold text-sm uppercase tracking-wider">포스팅 수정 및 피드백</h3>
                    <p className="text-xs text-black/50 leading-relaxed">
                      내용 중 수정하고 싶은 부분(예: '더 길게 써줘', '표를 추가해줘' 등)이 있다면 말씀해 주세요.
                    </p>
                  </div>

                  <div className="relative">
                    <textarea
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      placeholder="피드백을 입력하세요..."
                      className="w-full bg-[#F9F9F9] border-none rounded-xl px-4 py-3 h-32 text-sm focus:ring-2 focus:ring-black/5 transition-all outline-none resize-none"
                    />
                    {feedback && (
                      <button 
                        onClick={() => setFeedback('')}
                        className="absolute top-3 right-3 p-1 text-black/20 hover:text-red-500 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={refinePost}
                      disabled={isLoading || !feedback}
                      className="absolute bottom-3 right-3 p-2 bg-black text-white rounded-lg hover:bg-black/80 transition-all disabled:opacity-30"
                    >
                      {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>

                  <div className="pt-4 border-t border-black/5">
                    <button
                      onClick={generateAssets}
                      disabled={isLoading}
                      className="w-full bg-black text-white rounded-xl py-4 font-bold flex items-center justify-center gap-2 hover:bg-black/90 transition-all disabled:opacity-50"
                    >
                      {isLoading ? (
                        <RefreshCw className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          이미지랑 태그 만들어줘
                          <ChevronRight className="w-5 h-5" />
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-emerald-500 rounded-lg text-white">
                      <Check className="w-4 h-4" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="font-bold text-sm text-emerald-900">작성 가이드 준수 완료</h4>
                      <p className="text-xs text-emerald-700/70 leading-relaxed">
                        KIC 페르소나, 전문적인 톤앤매너, 구조화된 레이아웃이 모두 적용되었습니다.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {step === Step.ASSETS && (
            <motion.div
              key="assets"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-12"
            >
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-3xl font-light tracking-tight">최종 에셋 패키지</h2>
                  <p className="text-black/50">블로그 업로드에 필요한 이미지 프롬프트와 해시태그입니다.</p>
                </div>
                <button 
                  onClick={() => setStep(Step.GENERATION)}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-black/5 rounded-lg text-sm font-bold hover:bg-black hover:text-white transition-all"
                >
                  <ArrowLeft className="w-4 h-4" />
                  본문으로 돌아가기
                </button>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 p-3 rounded-lg max-w-xl">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {imageAssets.map((asset) => (
                  <div key={asset.id} className="bg-white rounded-2xl shadow-sm border border-black/5 overflow-hidden flex flex-col">
                    <div className="p-6 flex-1 flex flex-col justify-between space-y-4">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="px-2 py-1 bg-black text-white text-[10px] font-bold rounded uppercase tracking-wider">
                            Image {asset.id}
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-black/30 block">프롬프트 (AI 생성용)</label>
                            <button 
                              onClick={() => copyToClipboard(asset.prompt, 'prompt', asset.id, 'prompt')}
                              className="p-1 hover:bg-black/5 rounded transition-colors"
                            >
                              {copiedField === `${asset.id}-prompt` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-black/20" />}
                            </button>
                          </div>
                          <p className="text-xs text-black/70 leading-relaxed bg-[#F9F9F9] p-3 rounded-lg border border-black/5">{asset.prompt}</p>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-black/30 block">파일명</label>
                            <button 
                              onClick={() => copyToClipboard(asset.filename, 'prompt', asset.id, 'filename')}
                              className="p-1 hover:bg-black/5 rounded transition-colors"
                            >
                              {copiedField === `${asset.id}-filename` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-black/20" />}
                            </button>
                          </div>
                          <p className="text-xs font-mono bg-[#F9F9F9] p-2 rounded border border-black/5 break-all">{asset.filename}</p>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-black/30 block">Alt 태그</label>
                            <button 
                              onClick={() => copyToClipboard(asset.alt, 'prompt', asset.id, 'alt')}
                              className="p-1 hover:bg-black/5 rounded transition-colors"
                            >
                              {copiedField === `${asset.id}-alt` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-black/20" />}
                            </button>
                          </div>
                          <p className="text-xs text-black/70 leading-relaxed">{asset.alt}</p>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-black/30 block">캡션</label>
                            <button 
                              onClick={() => copyToClipboard(asset.caption, 'prompt', asset.id, 'caption')}
                              className="p-1 hover:bg-black/5 rounded transition-colors"
                            >
                              {copiedField === `${asset.id}-caption` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-black/20" />}
                            </button>
                          </div>
                          <p className="text-xs italic text-black/50 leading-relaxed">{asset.caption}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                
                {/* Add More Button Card */}
                <button
                  onClick={generateMoreAssets}
                  disabled={isLoading}
                  className="bg-[#F9F9F9] border-2 border-dashed border-black/5 rounded-2xl flex flex-col items-center justify-center p-8 space-y-4 hover:border-black/20 transition-all group min-h-[300px]"
                >
                  <div className="p-4 bg-white rounded-full shadow-sm group-hover:scale-110 transition-transform">
                    {isLoading ? <RefreshCw className="w-6 h-6 animate-spin" /> : <RefreshCw className="w-6 h-6" />}
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-sm">이미지 에셋 추가 생성</p>
                    <p className="text-xs text-black/40 mt-1">기존 에셋은 유지하고 3개를 더 만듭니다.</p>
                  </div>
                </button>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-black text-white rounded-lg">
                      <Hash className="w-5 h-5" />
                    </div>
                    <h3 className="font-bold tracking-tight">추천 해시태그</h3>
                  </div>
                  <button
                    onClick={() => copyToClipboard(hashtags, 'tags')}
                    className="flex items-center gap-2 px-4 py-2 bg-[#F9F9F9] rounded-lg text-sm font-bold hover:bg-black hover:text-white transition-all"
                  >
                    {copiedTags ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    {copiedTags ? '복사됨' : '태그 전체 복사'}
                  </button>
                </div>
                <div className="bg-[#F9F9F9] p-6 rounded-xl border border-black/5">
                  <p className="text-sm font-mono leading-relaxed text-black/70 whitespace-pre-wrap">
                    {hashtags}
                  </p>
                </div>
              </div>

              {/* Quick Quote Request Section */}
              <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-8 flex flex-col space-y-6">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-black text-white rounded-lg">
                    <FileText className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold tracking-tight">교정 문의 바로가기</h3>
                </div>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/30 block">URL</label>
                      <button 
                        onClick={() => copyToClipboard('https://www.kic21.co.kr/contents/write?mode=write&boardIdx=145&bUrl=%2Fcontents%2Flist%3FboardIdx%3D145', 'prompt', 999, 'quote-url')}
                        className="p-1 hover:bg-black/5 rounded transition-colors"
                        title="URL 복사"
                      >
                        {copiedField === '999-quote-url' ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-black/20 hover:text-black" />}
                      </button>
                    </div>
                    <p className="text-xs text-black/70 font-mono bg-[#F9F9F9] p-3 rounded-lg border border-black/5 break-all">
                      https://www.kic21.co.kr/contents/write?mode=write&boardIdx=145&bUrl=%2Fcontents%2Flist%3FboardIdx%3D145
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/30 block">캡션</label>
                      <button 
                        onClick={() => copyToClipboard('▲ 위 이미지를 클릭하시면 간편 견적 문의 페이지로 이동합니다.', 'prompt', 999, 'quote-caption')}
                        className="p-1 hover:bg-black/5 rounded transition-colors"
                        title="캡션 복사"
                      >
                        {copiedField === '999-quote-caption' ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-black/20 hover:text-black" />}
                      </button>
                    </div>
                    <p className="text-xs text-black/70 bg-[#F9F9F9] p-3 rounded-lg border border-black/5 break-all">
                      ▲ 위 이미지를 클릭하시면 간편 견적 문의 페이지로 이동합니다.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-black text-white p-12 rounded-[32px] text-center space-y-6">
                <h3 className="text-3xl font-light tracking-tight">모든 준비가 끝났습니다.</h3>
                <p className="text-white/60 max-w-lg mx-auto leading-relaxed">
                  본문, 이미지 프롬프트, 해시태그를 모두 복사하여 네이버 블로그에 업로드하세요. 
                  KIC의 신뢰도를 높이는 완벽한 포스팅이 될 것입니다.
                </p>
                <div className="pt-4">
                  <button 
                    onClick={() => {
                      setStep(Step.INPUT);
                      setBlogPost('');
                      setImageAssets([]);
                      setHashtags('');
                      setCategory('');
                      setTopic('');
                      setAttachedFile(null);
                      setFeedback('');
                      setError(null);
                    }}
                    className="px-8 py-4 bg-white text-black rounded-full font-bold hover:bg-white/90 transition-all"
                  >
                    새 포스팅 작성하기
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-6 py-12 border-t border-black/5 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/20">
          © 2026 KOREA INSTRUMENT (KIC) AI MARKETING SOLUTION
        </p>
      </footer>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold tracking-tight">카테고리 설정</h3>
                  <button 
                    onClick={() => setIsSettingsOpen(false)}
                    className="p-2 hover:bg-black/5 rounded-full transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5 rotate-90" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      placeholder="새 카테고리 이름..."
                      className="flex-1 bg-[#F9F9F9] border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-black/5 transition-all outline-none"
                      onKeyDown={(e) => e.key === 'Enter' && addCategory()}
                    />
                    <button 
                      onClick={addCategory}
                      className="px-4 bg-black text-white rounded-xl font-bold text-sm hover:bg-black/80 transition-all"
                    >
                      추가
                    </button>
                  </div>

                  <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                    {categories.map((cat) => (
                      <div key={cat} className="flex items-center justify-between p-3 bg-[#F9F9F9] rounded-xl group relative">
                        {editingCategory === cat ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={saveEdit}
                            onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                            className="flex-1 bg-white border border-black/10 rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-black/5"
                          />
                        ) : (
                          <span 
                            className="text-sm font-medium cursor-pointer hover:text-black/60 transition-colors flex-1"
                            onClick={() => startEditing(cat)}
                          >
                            {cat}
                          </span>
                        )}
                        
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => setCategoryToDelete(cat)}
                            className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <AlertCircle className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Inline Delete Confirmation */}
                        <AnimatePresence>
                          {categoryToDelete === cat && (
                            <motion.div 
                              initial={{ opacity: 0, x: 20 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 20 }}
                              className="absolute inset-0 bg-white rounded-xl flex items-center justify-between px-4 z-10 border border-red-100"
                            >
                              <span className="text-xs font-bold text-red-500">정말 삭제할까요?</span>
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => setCategoryToDelete(null)}
                                  className="text-[10px] font-bold uppercase tracking-wider text-black/40 hover:text-black"
                                >
                                  취소
                                </button>
                                <button 
                                  onClick={() => removeCategory(cat)}
                                  className="text-[10px] font-bold uppercase tracking-wider text-red-500 hover:text-red-600"
                                >
                                  삭제
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-black/90 transition-all"
                >
                  완료
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
