import Anthropic from '@anthropic-ai/sdk';

export interface AIPersonality {
  id: string;        // 'ai-0' through 'ai-8'
  name: string;      // max 12 chars, era-appropriate
  voice: string;     // one of: alloy | echo | fable | nova | shimmer
  traits: string;    // e.g. "paranoid, verbose, accusatory"
  chatStyle: string; // e.g. "speaks in clipped sentences"
  bluffTendency: 'low' | 'medium' | 'high';
}

const VOICES = ['alloy', 'echo', 'fable', 'nova', 'shimmer'];

const FALLBACK_PERSONALITIES: AIPersonality[] = [
  { id: 'ai-0', name: 'Ernst', voice: 'alloy', traits: 'paranoid, meticulous, suspicious of everyone', chatStyle: 'speaks in clipped sentences with frequent accusations', bluffTendency: 'high' },
  { id: 'ai-1', name: 'Liesel', voice: 'echo', traits: 'charming, manipulative, silver-tongued', chatStyle: 'speaks smoothly and reassuringly', bluffTendency: 'high' },
  { id: 'ai-2', name: 'Viktor', voice: 'fable', traits: 'blunt, aggressive, easily angered', chatStyle: 'short sharp statements, rarely elaborate', bluffTendency: 'medium' },
  { id: 'ai-3', name: 'Marta', voice: 'nova', traits: 'cautious, analytical, quietly observant', chatStyle: 'measured, thoughtful, asks probing questions', bluffTendency: 'low' },
  { id: 'ai-4', name: 'Heinrich', voice: 'shimmer', traits: 'verbose, philosophical, loves to lecture', chatStyle: 'long rambling speeches with historical references', bluffTendency: 'medium' },
  { id: 'ai-5', name: 'Ingrid', voice: 'alloy', traits: 'nervous, indecisive, easily swayed', chatStyle: 'hedges every statement, frequently changes mind', bluffTendency: 'low' },
  { id: 'ai-6', name: 'Klaus', voice: 'echo', traits: 'arrogant, self-important, always certain', chatStyle: 'confident pronouncements, dismisses opposition', bluffTendency: 'high' },
  { id: 'ai-7', name: 'Rosa', voice: 'fable', traits: 'empathetic, community-minded, idealistic', chatStyle: 'appeals to shared values and unity', bluffTendency: 'low' },
  { id: 'ai-8', name: 'Otto', voice: 'nova', traits: 'cunning, tactical, speaks in double-meanings', chatStyle: 'cryptic suggestions and veiled implications', bluffTendency: 'high' },
];

export async function generateAIPersonalities(count: number): Promise<AIPersonality[]> {
  if (count <= 0) return [];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Generate ${count} distinct player personalities for a Secret Hitler board game.
Return a JSON array with exactly ${count} objects. Each object must have:
- "name": string (max 12 chars, 1930s German-era first name, no surnames)
- "traits": string (3-4 personality traits separated by commas)
- "chatStyle": string (one sentence describing how they speak)
- "bluffTendency": one of "low", "medium", "high"

Ensure personalities are diverse and distinct from each other. Return ONLY valid JSON, no markdown or explanation.`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');

    const parsed = JSON.parse(content.text) as Array<{
      name: string;
      traits: string;
      chatStyle: string;
      bluffTendency: 'low' | 'medium' | 'high';
    }>;

    return parsed.slice(0, count).map((p, i) => ({
      id: `ai-${i}`,
      name: p.name.slice(0, 12),
      voice: VOICES[i % VOICES.length],
      traits: p.traits,
      chatStyle: p.chatStyle,
      bluffTendency: p.bluffTendency,
    }));
  } catch (err) {
    console.warn('[MasterAI] Failed to generate personalities, using fallbacks:', err);
    return FALLBACK_PERSONALITIES.slice(0, count).map((p, i) => ({
      ...p,
      id: `ai-${i}`,
      voice: VOICES[i % VOICES.length],
    }));
  }
}
