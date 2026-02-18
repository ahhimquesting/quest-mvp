import type { Env } from '../types'

export interface AIVerificationResult {
  confidence: number
  decision: 'APPROVE' | 'REJECT' | 'UNCERTAIN'
  reasoning: string
  detected_actions: string[]
  matches_description: boolean
  safety_flags: string[]
}

const VERIFICATION_PROMPT = `You are a quest verification AI. Analyze the video frames and audio transcript to determine if the quest was completed.

Respond with structured JSON:
{
  "confidence": <0-100>,
  "decision": "APPROVE" | "REJECT" | "UNCERTAIN",
  "reasoning": "<2-3 sentences>",
  "detected_actions": ["<action1>", "<action2>"],
  "matches_description": <true/false>,
  "safety_flags": ["<flag1>"]
}

Be strict but fair. Only APPROVE if clearly completed. Flag any unsafe content (violence, nudity, self-harm, etc). Empty safety_flags array if none.`

export async function transcribeAudio(videoBlob: Blob, env: Env): Promise<string> {
  const formData = new FormData()
  formData.append('file', videoBlob, 'video.mp4')
  formData.append('model', 'whisper-1')
  formData.append('language', 'en')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: formData,
  })

  if (!res.ok) {
    throw new Error(`Whisper API error: ${res.status}`)
  }

  const data = (await res.json()) as { text?: string }
  return data.text || ''
}

export async function analyzeFrames(
  description: string,
  transcript: string,
  frames: { base64: string; mimeType: string }[],
  env: Env,
): Promise<AIVerificationResult> {
  const imageContent = frames.map((f) => ({
    type: 'image_url' as const,
    image_url: { url: `data:${f.mimeType};base64,${f.base64}` },
  }))

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: VERIFICATION_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Quest description: ${description}\n\nAudio transcript: ${transcript || '(no audio detected)'}\n\nAnalyze the following ${frames.length} video frames:`,
            },
            ...imageContent,
          ],
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1000,
    }),
  })

  if (!res.ok) {
    throw new Error(`OpenAI API error: ${res.status}`)
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>
  }

  return JSON.parse(data.choices[0].message.content)
}
