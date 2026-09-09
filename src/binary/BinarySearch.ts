import { BinaryReader } from './BinaryReader';
import { compileSearch, scanBuffer, CompiledPattern } from '../core/SearchPattern';
import type { SearchMatch, SearchQuery } from '../types/messages';

const CHUNK = 1 << 20; // 1 MiB scan window
const TIME_BUDGET_MS = 2500;

export interface SearchOutcome {
  matches: SearchMatch[];
  done: boolean;
  /** Offset up to which the file has been scanned (for incremental "find all"). */
  scannedTo: number;
}

/**
 * Stream the file through a compiled matcher, chunk by chunk, with an overlap of
 * (patternLength - 1) so matches that straddle chunk boundaries are still found.
 * The whole file is never held in memory.
 */
export async function searchBinary(
  reader: BinaryReader,
  query: SearchQuery,
  opts: { maxResults: number },
): Promise<SearchOutcome> {
  const pattern = compileSearch(query);
  const overlap = Math.max(0, pattern.length - 1);
  const size = reader.size;
  const deadline = Date.now() + TIME_BUDGET_MS;

  if (query.direction === 'previous') {
    return searchBackward(reader, pattern, query.from, size, overlap, deadline);
  }

  const limit = query.direction === 'all' ? Math.max(1, opts.maxResults) : 1;
  const found: number[] = [];
  const seen = new Set<number>();
  let pos = Math.max(0, Math.min(query.from, size));

  while (pos < size) {
    const readLen = Math.min(CHUNK + overlap, size - pos);
    const buf = await reader.read(pos, readLen);
    const hits = scanBuffer(pattern, buf, pos, {
      limit: limit - found.length,
      // Only "own" the first CHUNK bytes; the overlap tail is owned by the next chunk,
      // except for the final chunk which owns everything it holds.
      endInBuf: pos + CHUNK >= size ? buf.length : Math.min(buf.length, CHUNK + overlap),
    });
    for (const h of hits) {
      if (h >= pos + CHUNK && pos + CHUNK < size) {
        continue; // belongs to next chunk
      }
      if (!seen.has(h)) {
        seen.add(h);
        found.push(h);
      }
      if (found.length >= limit) {
        break;
      }
    }
    if (found.length >= limit) {
      return { matches: toMatches(found, pattern.length), done: true, scannedTo: size };
    }
    pos += CHUNK;
    if (Date.now() > deadline) {
      return { matches: toMatches(found, pattern.length), done: false, scannedTo: pos };
    }
  }
  return { matches: toMatches(found, pattern.length), done: true, scannedTo: size };
}

async function searchBackward(
  reader: BinaryReader,
  pattern: CompiledPattern,
  from: number,
  size: number,
  overlap: number,
  deadline: number,
): Promise<SearchOutcome> {
  let end = Math.max(0, Math.min(from, size)); // exclusive upper bound for a match START
  while (end > 0) {
    const start = Math.max(0, end - CHUNK);
    const readLen = Math.min(end - start + overlap, size - start);
    const buf = await reader.read(start, readLen);
    const hits = scanBuffer(pattern, buf, start, { endInBuf: end - start });
    if (hits.length > 0) {
      const offset = hits[hits.length - 1];
      return { matches: [{ offset, length: pattern.length }], done: true, scannedTo: 0 };
    }
    end = start;
    if (Date.now() > deadline) {
      return { matches: [], done: false, scannedTo: end };
    }
  }
  return { matches: [], done: true, scannedTo: 0 };
}

function toMatches(offsets: number[], length: number): SearchMatch[] {
  return offsets.map((offset) => ({ offset, length }));
}
