import type { GameLogEntry, GameResult } from '../../shared/src';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function buildNarrationText(entry: GameLogEntry): string | null {
  const pres = entry.presidentName;
  const chan = entry.chancellorName ?? '';
  const target = entry.targetName ?? '';
  const yes = entry.votesYes ?? 0;
  const no = entry.votesNo ?? 0;

  switch (entry.type) {
    case 'election-passed':
      return `${pres} and ${chan} have been elected. The vote passed ${yes} to ${no}.`;
    case 'election-failed':
      return `The government of ${pres} and ${chan} has been rejected — ${yes} for, ${no} against. The election tracker advances.`;
    case 'policy-enacted':
      if (entry.policy === 'liberal') {
        return `A Liberal policy has been enacted by ${pres} and ${chan}.`;
      } else {
        return `A Fascist policy has been enacted by ${pres} and ${chan}.`;
      }
    case 'chaos-policy': {
      const type = entry.policy === 'liberal' ? 'Liberal' : 'Fascist';
      return `Chaos! Three governments have failed. A ${type} policy is enacted from the top of the deck.`;
    }
    case 'execution':
      return `President ${pres} has ordered the execution of ${target}. The people watch in silence.`;
    case 'investigation':
      return `President ${pres} has investigated the loyalty of ${target}.`;
    case 'special-election':
      return `President ${pres} has called a special election. ${target} will serve as the next President.`;
    case 'veto-approved':
      return `The agenda has been vetoed. Both ${pres} and ${chan} agreed to discard all policies. The election tracker advances.`;
    default:
      return null;
  }
}

export async function narrateLogEntry(entry: GameLogEntry): Promise<string | null> {
  const text = buildNarrationText(entry);
  if (!text) return null;
  return callTTS(text);
}

export async function narrateGameOver(result: GameResult): Promise<string | null> {
  let text: string;
  switch (result.condition) {
    case 'liberals-policies':
      text = 'The Liberals have enacted five Liberal policies. Democracy prevails. The Liberals win!';
      break;
    case 'liberals-hitler-killed':
      text = 'Hitler has been assassinated! The Liberal forces have triumphed. The Liberals win!';
      break;
    case 'fascists-policies':
      text = 'The Fascists have seized power, enacting six Fascist policies. The regime is complete. The Fascists win!';
      break;
    case 'fascists-hitler-elected':
      text = 'Hitler has been elected Chancellor. The Fascist conspiracy succeeds. The Fascists win!';
      break;
    default:
      return null;
  }
  return callTTS(text);
}

export async function callTTSWithVoice(text: string, voice: string = 'onyx'): Promise<string | null> {
  if (!OPENAI_API_KEY) {
    console.warn('[TTS] OPENAI_API_KEY not set — skipping narration');
    return null;
  }
  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice,
        response_format: 'mp3',
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[TTS] API error ${response.status}: ${errorText}`);
      return null;
    }
    const buffer = await response.arrayBuffer();
    console.log(`[TTS] Generated narration (${buffer.byteLength} bytes): "${text.slice(0, 60)}..."`);
    return Buffer.from(buffer).toString('base64');
  } catch (err) {
    console.warn('[TTS] Failed to generate narration:', err);
    return null;
  }
}

async function callTTS(text: string): Promise<string | null> {
  return callTTSWithVoice(text, 'onyx');
}
