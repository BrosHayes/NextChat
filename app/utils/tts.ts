export const DEFAULT_TTS_CHUNK_LENGTH = 260;

export type SplitTextForTTSOptions = {
  maxChunkLength?: number;
};

const STRONG_BREAK_CHARS = new Set([
  "\u3002",
  "\uff01",
  "\uff1f",
  "!",
  "?",
  ";",
  "\uff1b",
  ".",
]);
const SOFT_BREAK_CHARS = new Set([
  ",",
  "\uff0c",
  "\u3001",
  ":",
  "\uff1a",
  " ",
  "\t",
]);
const CLOSING_CHARS = new Set([
  '"',
  "'",
  ")",
  "]",
  "}",
  "\u201d",
  "\u2019",
  "\uff09",
  "\u3011",
  "\u300d",
  "\u300f",
]);

function normalizeParagraph(paragraph: string) {
  return paragraph.replace(/\s+/g, " ").trim();
}

function shouldBreakSentence(text: string, index: number) {
  const char = text[index];

  if (!STRONG_BREAK_CHARS.has(char)) {
    return false;
  }

  if (char !== ".") {
    return true;
  }

  const previousChar = text[index - 1] ?? "";
  const nextChar = text[index + 1] ?? "";

  return !(/\d/.test(previousChar) && /\d/.test(nextChar));
}

function splitIntoSentences(paragraph: string) {
  const sentences: string[] = [];
  let current = "";

  for (let index = 0; index < paragraph.length; index += 1) {
    current += paragraph[index];

    if (!shouldBreakSentence(paragraph, index)) {
      continue;
    }

    while (
      index + 1 < paragraph.length &&
      CLOSING_CHARS.has(paragraph[index + 1])
    ) {
      index += 1;
      current += paragraph[index];
    }

    while (index + 1 < paragraph.length && /\s/.test(paragraph[index + 1])) {
      index += 1;
      current += paragraph[index];
    }

    if (current.trim()) {
      sentences.push(current);
      current = "";
    }
  }

  if (current.trim()) {
    sentences.push(current);
  }

  return sentences;
}

function findSplitIndex(text: string, maxChunkLength: number) {
  const minimumPreferredIndex = Math.floor(maxChunkLength / 2);

  for (
    let index = Math.min(text.length, maxChunkLength) - 1;
    index >= 0;
    index -= 1
  ) {
    if (!SOFT_BREAK_CHARS.has(text[index])) {
      continue;
    }

    if (index < minimumPreferredIndex) {
      break;
    }

    return text[index] === " " || text[index] === "\t" ? index : index + 1;
  }

  return maxChunkLength;
}

function hardSplitText(text: string, maxChunkLength: number) {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > maxChunkLength) {
    const splitIndex = findSplitIndex(remaining, maxChunkLength);
    const chunk = remaining.slice(0, splitIndex).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function splitParagraph(paragraph: string, maxChunkLength: number) {
  if (paragraph.length <= maxChunkLength) {
    return [paragraph];
  }

  const chunks: string[] = [];
  const sentences = splitIntoSentences(paragraph);
  let current = "";

  const flushCurrent = () => {
    const value = current.trim();

    if (value) {
      chunks.push(value);
    }

    current = "";
  };

  for (const sentence of sentences) {
    if (sentence.trim().length > maxChunkLength) {
      flushCurrent();
      chunks.push(...hardSplitText(sentence, maxChunkLength));
      continue;
    }

    if (!current) {
      current = sentence;
      continue;
    }

    const candidate = `${current}${sentence}`;

    if (candidate.trim().length <= maxChunkLength) {
      current = candidate;
      continue;
    }

    flushCurrent();
    current = sentence;
  }

  flushCurrent();

  return chunks;
}

export function splitTextForTTS(
  text: string,
  options: SplitTextForTTSOptions = {},
): string[] {
  const maxChunkLength =
    options.maxChunkLength ?? DEFAULT_TTS_CHUNK_LENGTH;
  const normalizedText = text.replace(/\r\n?/g, "\n").trim();

  if (!normalizedText) {
    return [];
  }

  return normalizedText
    .split(/\n\s*\n+/)
    .map(normalizeParagraph)
    .filter(Boolean)
    .flatMap((paragraph) => splitParagraph(paragraph, maxChunkLength));
}
