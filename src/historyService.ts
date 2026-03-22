import { get, set, del, keys } from 'idb-keyval';

export interface HistoryItem {
  id: string;
  timestamp: number;
  imagePreviewUrl: string; // Base64 or object URL (we'll store base64)
  result: string;
  language: 'en' | 'my';
  type: 'analysis' | 'generation';
}

const HISTORY_KEY_PREFIX = 'lookout_history_';

export async function saveToHistory(item: Omit<HistoryItem, 'id' | 'timestamp'>): Promise<HistoryItem> {
  const id = Date.now().toString();
  const historyItem: HistoryItem = {
    ...item,
    id,
    timestamp: Date.now(),
  };
  
  await set(`${HISTORY_KEY_PREFIX}${id}`, historyItem);
  return historyItem;
}

export async function getHistory(): Promise<HistoryItem[]> {
  const allKeys = await keys();
  const historyKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith(HISTORY_KEY_PREFIX));
  
  const items: HistoryItem[] = [];
  for (const key of historyKeys) {
    const item = await get<HistoryItem>(key);
    if (item) {
      items.push(item);
    }
  }
  
  // Sort by newest first
  return items.sort((a, b) => b.timestamp - a.timestamp);
}

export async function deleteFromHistory(id: string): Promise<void> {
  await del(`${HISTORY_KEY_PREFIX}${id}`);
}
