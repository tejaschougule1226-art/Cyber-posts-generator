import { useState, useEffect, useRef } from 'react';
import { RefreshCw, Newspaper, Linkedin, Twitter, Instagram, AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Clock3, History, LayoutDashboard } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import localforage from "localforage";
import * as htmlToImage from 'html-to-image';

interface InstagramSlide {
  headline: string;
  bodyText: string;
  imagePrompt: string;
}

interface GeneratedPosts {
  id: string;
  createdAt: string;
  newsSummary: string | string[];
  linkedinPost: string;
  xPost: string;
  instagramSlides: InstagramSlide[];
  imageUrls: string[];
}

// Ensure the GoogleGenAI instance is correctly initialized in the browser
const getAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  // In some environments, it might be string literal "undefined" or empty
  if (!apiKey || apiKey === "undefined" || apiKey === "") {
    throw new Error("API Key not found. Please ensure GEMINI_API_KEY is set in your environment/secrets.");
  }
  return new GoogleGenAI({ apiKey });
};

export default function App() {
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<GeneratedPosts[]>([]);
  const [activePost, setActivePost] = useState<GeneratedPosts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);

  const slideRef = useRef<HTMLDivElement>(null);

  const downloadCurrentSlide = async () => {
    if (!slideRef.current) return;
    try {
      const dataUrl = await htmlToImage.toJpeg(slideRef.current, { quality: 0.95, pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = `cyberpulse-ig-frame-${carouselIndex + 1}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error('Failed to generate image', e);
      alert("Failed to render the image for export. Please try again.");
    }
  };

  useEffect(() => {
    localforage.getItem('cyberpulse-history').then((saved) => {
      if (saved) {
        try {
          setHistory(saved as GeneratedPosts[]);
        } catch (e) {
          console.error("Failed to parse history", e);
        }
      }
    }).catch((e) => console.error("Failed to load history from localforage", e));
  }, []);

  const saveHistory = async (newHistory: GeneratedPosts[]) => {
    setHistory(newHistory);
    try {
      // Keep only the last 10 entries to preserve space even in IndexedDB, as images are large.
      const trimmedHistory = newHistory.slice(0, 10);
      await localforage.setItem('cyberpulse-history', trimmedHistory);
    } catch (e) {
      console.error("Failed to save history", e);
    }
  };

  const generatePosts = async () => {
    setLoading(true);
    setError(null);
    setActivePost(null);
    try {
      const ai = getAI();

      // 1. Fetch news and generate text posts
      console.log("Fetching news and generating text...");
      const textResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "Search the web for the top most important cybersecurity news articles from the last 24 hours. Analyze them, then respond with ONLY a JSON object and no other text or explanation. The JSON object must have exactly these keys: \n- newsSummary: A bulleted summary of the top news items found in the last 24 hours.\n- linkedinPost: A professional and engaging LinkedIn post summarizing the news, including emojis and hashtags.\n- xPost: A punchy, attention-grabbing X (Twitter) post or short thread about the most critical news item, with hashtags.\n- instagramSlides: An array of 3 to 5 objects for an Instagram carousel. Each object must have:\n  - \"headline\": A short, punchy ALL CAPS headline summarizing the news point (max 80 chars).\n  - \"bodyText\": A short explanation of the news (1-2 sentences).\n  - \"imagePrompt\": A prompt for an AI image generator to create a dark, moody, futuristic hacker/cybersecurity themed abstract background image (no text in the image) featuring neon green accents, suitable for use as a background for text.",
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      let responseText = textResponse.text || "{}";
      // Try to clean markdown formatting if present
      if (responseText.startsWith("```json")) {
        responseText = responseText.replace(/^```json\n/, "").replace(/```$/, "");
      } else if (responseText.startsWith("```")) {
        responseText = responseText.replace(/^```\n/, "").replace(/```$/, "");
      }

      const generatedData = JSON.parse(responseText.trim());

      const slides: InstagramSlide[] = generatedData.instagramSlides || [];
      if (!slides || slides.length === 0) {
        throw new Error("Failed to generate instagram slides");
      }

      // 2. Generate Images for Instagram using the generated prompts
      console.log("Generating background images based on slides...");
      const imagePromises = slides.map(async (slide) => {
        const imageResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: {
            parts: [{ text: slide.imagePrompt }],
          },
          config: {
            imageConfig: { aspectRatio: "1:1" }
          }
        });

        let base64EncodeString = "";
        if (imageResponse.candidates && imageResponse.candidates.length > 0) {
          for (const part of imageResponse.candidates[0].content?.parts || []) {
            if (part.inlineData && part.inlineData.data) {
              base64EncodeString = part.inlineData.data;
              break;
            }
          }
        }
        return base64EncodeString ? `data:image/jpeg;base64,${base64EncodeString}` : null;
      });

      const imageUrlResults = await Promise.all(imagePromises);
      const imageUrls = imageUrlResults.filter(url => url !== null) as string[];

      const newPost: GeneratedPosts = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...generatedData,
        instagramSlides: slides,
        imageUrls,
      };

      setActivePost(newPost);
      setCarouselIndex(0);
      saveHistory([newPost, ...history]);
      
    } catch (err: any) {
      console.error(err);
      let message = err instanceof Error ? err.message : 'An unknown error occurred.';
      if (err?.message?.includes('API_KEY_INVALID') || err?.message?.includes('API key not valid') || err?.message?.includes('API Key not found')) {
        message = "The Gemini API key is invalid or missing. Please update your GEMINI_API_KEY in the Settings > Secrets panel.";
      } else if (err?.message?.includes('503') || err?.status === 503 || err?.message?.includes('high demand') || err?.message?.includes('UNAVAILABLE')) {
        message = "The AI model is currently experiencing high demand. Please wait a few moments and try again.";
      } else if (err?.message?.includes('429') || err?.status === 429 || err?.message?.includes('quota') || err?.message?.includes('RESOURCE_EXHAUSTED')) {
        message = "You have exceeded your Gemini API quota. Please try again later or upgrade your plan.";
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Ideally add a little toast here, but keeping it simple
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-300 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <Newspaper className="w-5 h-5" />
            </div>
            <h1 className="font-semibold text-zinc-100 tracking-tight">CyberPulse AI</h1>
          </div>
          <button
            onClick={generatePosts}
            disabled={loading}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 px-5 py-2 rounded-full font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(16,185,129,0.2)] disabled:shadow-none text-sm"
          >
            {loading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {loading ? 'Mining Intelligence...' : 'Generate New Posts'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        
        {/* Error State */}
        {error && (
          <div className="mb-8 p-6 bg-red-950/20 border border-red-900/50 rounded-2xl flex items-start gap-4">
             <AlertCircle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
             <div>
               <h3 className="text-red-400 font-medium text-lg">Intel Gathering Failed</h3>
               <p className="text-red-400/80 mt-1">{error}</p>
             </div>
          </div>
        )}

        {/* Back Button */}
        {activePost && !loading && (
          <button 
            onClick={() => setActivePost(null)}
            className="flex items-center gap-2 text-zinc-400 hover:text-emerald-400 font-medium transition-colors mb-6 text-sm"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to All Posts
          </button>
        )}

        {/* Welcome State / Empty History */}
        {!activePost && history.length === 0 && !loading && !error && (
          <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center shadow-2xl">
              <Newspaper className="w-8 h-8 text-zinc-600" />
            </div>
            <div className="max-w-md">
              <h2 className="text-2xl font-bold text-zinc-100 mb-2">No Intel Found</h2>
              <p className="text-zinc-500">
                Click the "Generate New Posts" button above to scan the last 24 hours of cybersecurity intelligence and craft optimized posts for your social channels.
              </p>
            </div>
          </div>
        )}

        {/* History List (Home Page) */}
        {!activePost && history.length > 0 && !loading && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center mb-6">
              <h2 className="text-xl font-semibold text-zinc-100">Generated Reports</h2>
            </div>
            {history.map((item) => (
              <div 
                key={item.id} 
                className="p-6 bg-zinc-900/50 border border-white/5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 group hover:bg-zinc-800/80 hover:border-emerald-500/30 transition-all cursor-pointer shadow-lg"
                onClick={() => {
                  setActivePost(item);
                  setCarouselIndex(0);
                }}
              >
                <div>
                  <div className="flex items-center gap-2 text-zinc-400 text-xs mb-2">
                    <Clock3 className="w-3.5 h-3.5" />
                    {new Date(item.createdAt).toLocaleString()}
                  </div>
                  <h3 className="font-medium text-zinc-200 line-clamp-1 text-lg">
                    {Array.isArray(item.newsSummary) ? item.newsSummary[0] : (typeof item.newsSummary === 'string' ? item.newsSummary.split('\n')[0] : 'Cybersecurity Intelligence Report')}
                  </h3>
                </div>
                <div className="flex items-center gap-2 text-sm text-emerald-400 font-medium whitespace-nowrap bg-emerald-500/10 px-4 py-2 rounded-full group-hover:bg-emerald-500 group-hover:text-emerald-950 transition-colors">
                  View Intelligence &rarr;
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Results / Active Post Detail View */}
        {activePost && !loading && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 mt-4">
            
            {/* Intel Summary */}
            <section className="bg-zinc-900/30 border border-white/5 rounded-2xl p-8 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-emerald-500/10 rounded-max text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <h2 className="text-xl font-medium text-zinc-100 tracking-tight">Report Intel Summary - {new Date(activePost.createdAt).toLocaleString()}</h2>
              </div>
              <div className="prose prose-invert max-w-none text-zinc-400 leading-relaxed">
                {/* Splitting the summary if it has newlines or mapping if it's an array */}
                {Array.isArray(activePost.newsSummary) ? (
                  activePost.newsSummary.map((line, i) => (
                    <p key={i} className="mb-2">{line}</p>
                  ))
                ) : (
                  typeof activePost.newsSummary === 'string' ? activePost.newsSummary.split('\n').map((line, i) => (
                    <p key={i} className="mb-2">{line}</p>
                  )) : null
                )}
              </div>
            </section>

            {/* Content Outputs */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* LinkedIn */}
              <div className="bg-zinc-900 border border-white/5 rounded-2xl overflow-hidden flex flex-col group">
                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-zinc-950/50">
                  <div className="flex items-center gap-2 text-[#0A66C2]">
                    <Linkedin className="w-5 h-5" />
                    <span className="font-medium text-zinc-200">LinkedIn</span>
                  </div>
                  <button onClick={() => copyToClipboard(activePost.linkedinPost)} className="text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-wider">
                    Copy Text
                  </button>
                </div>
                <div className="p-6 flex-1 overflow-y-auto whitespace-pre-wrap text-sm text-zinc-300">
                  {activePost.linkedinPost}
                </div>
              </div>

              {/* X (Twitter) */}
              <div className="bg-zinc-900 border border-white/5 rounded-2xl overflow-hidden flex flex-col group">
                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-zinc-950/50">
                  <div className="flex items-center gap-2 text-zinc-100">
                    <Twitter className="w-5 h-5 fill-current" />
                    <span className="font-medium text-zinc-200">X (Twitter)</span>
                  </div>
                  <button onClick={() => copyToClipboard(activePost.xPost)} className="text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-wider">
                    Copy Text
                  </button>
                </div>
                <div className="p-6 flex-1 overflow-y-auto whitespace-pre-wrap text-sm text-zinc-300">
                  {activePost.xPost}
                </div>
              </div>

              {/* Instagram */}
              <div className="bg-zinc-900 border border-white/5 rounded-2xl overflow-hidden flex flex-col group">
                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-zinc-950/50">
                  <div className="flex items-center gap-2 text-[#E1306C]">
                    <Instagram className="w-5 h-5" />
                    <span className="font-medium text-zinc-200">Instagram Carousel ({activePost.imageUrls?.length || 0})</span>
                  </div>
                </div>
                <div className="p-6 flex-1 flex flex-col items-center justify-center gap-6">
                  {activePost.imageUrls && activePost.imageUrls.length > 0 ? (
                    <div className="w-full flex-col flex items-center gap-4">
                      {/* Interactive Presentation container */}
                       <div className="relative w-full aspect-square rounded-xl overflow-hidden border border-white/10 shadow-2xl group/carousel mx-auto">
                        
                         {/* The actual HTML structure we will export */}
                         <div 
                           ref={slideRef}
                           className="absolute inset-0 bg-[#050505] flex flex-col font-sans @container overflow-hidden"
                           style={{ width: '100%', height: '100%' }}
                         >
                           {/* Background Image with Cyber Tint */}
                           <div className="absolute inset-0 bg-black">
                              <img 
                                src={activePost.imageUrls[carouselIndex]} 
                                alt={`Carousel frame ${carouselIndex + 1}`} 
                                className="w-full h-full object-cover opacity-50 mix-blend-screen" 
                                crossOrigin="anonymous" 
                              />
                              {/* Darkening Gradients */}
                              <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-[#050505] opacity-90" />
                              <div className="absolute inset-0 bg-gradient-to-b from-[#050505]/80 via-transparent to-[#050505]/60" />
                              
                              {/* Scanline Effect */}
                              <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(rgba(16,185,129,1) 1px, transparent 1px)', backgroundSize: '100% 4px' }} />
                           </div>
                           
                           {/* Cyber Logo (Top Left) */}
                           <div className="absolute top-[6cqh] left-[6cqw] flex items-center gap-3 z-10">
                             <div className="relative">
                               <div className="w-[10cqw] h-[10cqw] bg-emerald-500 rounded-sm flex items-center justify-center rotate-3 translate-x-1 translate-y-1 opacity-20 absolute inset-0" />
                               <div className="w-[10cqw] h-[10cqw] bg-emerald-500 rounded-sm flex items-center justify-center relative z-10 shadow-[0_0_20px_rgba(16,185,129,0.5)]">
                                 <span className="text-black font-black text-[5cqw] leading-none select-none">CP</span>
                               </div>
                             </div>
                             <div className="flex flex-col">
                               <span className="text-white font-black tracking-[0.15em] text-[4cqw] uppercase leading-none">CyberPulse</span>
                               <span className="text-emerald-500 font-mono text-[1.8cqw] uppercase tracking-[0.3em] font-bold mt-1">Intelligence Unit</span>
                             </div>
                           </div>

                           {/* Content Layout */}
                           <div className="absolute inset-x-[8cqw] bottom-[12cqh] flex flex-col items-center text-center z-20">
                              
                              {/* Floating Headline */}
                              <div className="relative mb-[6cqh] w-full">
                                <h2 className="text-[#10b981] font-black text-[8.5cqw] leading-[1] uppercase tracking-tighter drop-shadow-[0_0_15px_rgba(16,185,129,0.6)] animate-pulse-slow">
                                  {activePost.instagramSlides?.[carouselIndex]?.headline}
                                </h2>
                                {/* Accent Line */}
                                <div className="h-[0.8cqh] w-[30%] bg-emerald-500 mx-auto mt-4 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                              </div>

                              {/* Minimalist Body Text Container */}
                              <div className="relative px-6 py-4">
                                <div className="absolute inset-0 bg-white/5 backdrop-blur-sm rounded-lg border-l border-emerald-500/50" />
                                <p className="text-zinc-200 font-medium text-[3.8cqw] leading-[1.6] relative z-10 italic">
                                  "{activePost.instagramSlides?.[carouselIndex]?.bodyText}"
                                </p>
                              </div>
                           </div>
                           
                           {/* Decorative Corner Accents */}
                           <div className="absolute top-[3cqh] right-[3cqw] w-[12cqw] h-[12cqw] border-t-2 border-r-2 border-emerald-500/30 opacity-50" />
                           <div className="absolute bottom-[3cqh] left-[3cqw] w-[12cqw] h-[12cqw] border-b-2 border-l-2 border-emerald-500/30 opacity-50" />
                           
                           {/* Bottom Branding / URL */}
                           <div className="absolute bottom-[5cqh] right-[8cqw] z-10">
                              <span className="text-zinc-500 font-mono text-[2cqw] tracking-[0.2em] font-bold">WWW.CYBERPULSE.AI</span>
                           </div>
                         </div>
                         
                         {activePost.imageUrls.length > 1 && (
                           <>
                             <div className="absolute inset-0 flex items-center justify-between p-2 opacity-0 group-hover/carousel:opacity-100 transition-opacity z-20 pointer-events-none">
                               <button 
                                 onClick={(e) => { e.stopPropagation(); setCarouselIndex((prev) => (prev > 0 ? prev - 1 : (activePost.imageUrls?.length || 1) - 1)); }}
                                 className="w-8 h-8 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 backdrop-blur pointer-events-auto shadow-md"
                               >
                                 <ChevronLeft className="w-5 h-5" />
                               </button>
                               <button 
                                 onClick={(e) => { e.stopPropagation(); setCarouselIndex((prev) => (prev < (activePost.imageUrls?.length || 1) - 1 ? prev + 1 : 0)); }}
                                 className="w-8 h-8 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 backdrop-blur pointer-events-auto shadow-md"
                               >
                                 <ChevronRight className="w-5 h-5" />
                               </button>
                             </div>
                             <div className="absolute top-4 right-4 bg-black/60 backdrop-blur px-2.5 py-1 rounded-full text-xs font-medium text-white z-20 shadow-md">
                               {carouselIndex + 1} / {activePost.imageUrls.length}
                             </div>
                           </>
                         )}
                      </div>
                      
                      {activePost.imageUrls.length > 1 && (
                        <div className="flex items-center gap-2">
                          {activePost.imageUrls.map((_, idx) => (
                            <button
                              key={idx}
                              onClick={() => setCarouselIndex(idx)}
                              className={`w-2 h-2 rounded-full transition-all ${idx === carouselIndex ? 'bg-emerald-400 w-4' : 'bg-zinc-600 hover:bg-zinc-500'}`}
                            />
                          ))}
                        </div>
                      )}
                      
                      <button 
                        onClick={downloadCurrentSlide}
                        className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-sm font-semibold rounded-lg text-center transition-colors mt-2"
                      >
                        Download Carousel Frame {carouselIndex + 1}
                      </button>
                    </div>
                  ) : (
                    <div className="w-full aspect-square rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-center p-6 text-center">
                       <p className="text-sm text-zinc-500">Image generation failed or not available.</p>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

      </main>
    </div>
  );
}
