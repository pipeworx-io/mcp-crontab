interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Crontab expression MCP.
 *
 * Keyless, offline: parse a standard 5-field cron expression (minute hour
 * day-of-month month day-of-week), describe it in plain English, and compute
 * the next N run times (UTC). Supports wildcards, ranges (a-b), step values,
 * lists, month/day names, and @aliases (@daily, @hourly, @weekly, @monthly,
 * @yearly). Pure logic — no API, no key.
 */


const ALIASES: Record<string, string> = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *',
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAYNAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function names(field: string, list: string[]): string {
  let f = field.toLowerCase();
  list.forEach((n, i) => { f = f.replace(new RegExp(n, 'g'), String(list === MONTHS ? i + 1 : i)); });
  return f;
}

function parseField(field: string, min: number, max: number): number[] {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    let step = 1, range = part;
    const sl = part.split('/');
    if (sl.length === 2) { range = sl[0]; step = parseInt(sl[1], 10); if (!(step >= 1)) throw new Error(`Invalid step in "${part}".`); }
    let lo = min, hi = max;
    if (range === '*') { /* full */ }
    else if (range.includes('-')) { const [a, b] = range.split('-'); lo = +a; hi = +b; }
    else { lo = hi = +range; if (sl.length === 2) hi = max; } // "a/n" means a..max step n
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) throw new Error(`Field value "${part}" out of range ${min}-${max}.`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

function parse(expr: string) {
  const norm = ALIASES[expr.trim()] || expr.trim();
  const f = norm.split(/\s+/);
  if (f.length !== 5) throw new Error(`Expected 5 cron fields (or an @alias); got ${f.length}: "${expr}".`);
  const minute = parseField(f[0], 0, 59);
  const hour = parseField(f[1], 0, 23);
  const dom = parseField(f[2], 1, 31);
  const month = parseField(names(f[3], MONTHS), 1, 12);
  const dowRaw = parseField(names(f[4], DAYS), 0, 7).map((d) => (d === 7 ? 0 : d));
  const dow = [...new Set(dowRaw)].sort((a, b) => a - b);
  return { fields: f, minute, hour, dom, month, dow, domStar: f[2] === '*', dowStar: f[4] === '*' };
}

function describe(p: ReturnType<typeof parse>): string {
  const list = (a: number[], all: number) => (a.length === all ? 'every' : a.join(','));
  const time = p.minute.length === 1 && p.hour.length === 1 ? `at ${String(p.hour[0]).padStart(2, '0')}:${String(p.minute[0]).padStart(2, '0')}` :
    p.minute.length === 60 ? 'every minute' : `minute ${list(p.minute, 60)} of hour ${list(p.hour, 24)}`;
  const days = p.dowStar ? (p.domStar ? 'every day' : `on day-of-month ${p.dom.join(',')}`) :
    `on ${p.dow.map((d) => DAYNAMES[d]).join(', ')}${p.domStar ? '' : ` or day-of-month ${p.dom.join(',')}`}`;
  const months = p.month.length === 12 ? '' : ` in month(s) ${p.month.join(',')}`;
  return `Runs ${time}, ${days}${months} (UTC).`;
}

function matches(p: ReturnType<typeof parse>, d: Date): boolean {
  const mm = p.minute.includes(d.getUTCMinutes());
  const hh = p.hour.includes(d.getUTCHours());
  const mo = p.month.includes(d.getUTCMonth() + 1);
  const domM = p.dom.includes(d.getUTCDate());
  const dowM = p.dow.includes(d.getUTCDay());
  const dayOk = !p.domStar && !p.dowStar ? domM || dowM : domM && dowM;
  return mm && hh && mo && dayOk;
}

const tools: McpToolExport['tools'] = [
  {
    name: 'describe_cron',
    description: 'Parse and validate a cron expression (5 fields or an @alias) and describe it in plain English. Returns the parsed fields and whether it is valid.',
    inputSchema: { type: 'object', properties: { expression: { type: 'string', description: 'A cron expression, e.g. "0 9 * * 1-5" or "@daily".' } }, required: ['expression'] },
  },
  {
    name: 'next_runs',
    description: 'Compute the next N run times (UTC ISO-8601) for a cron expression. Optionally start from a given time.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'A cron expression or @alias.' },
        count: { type: 'number', description: 'How many upcoming runs to return (1-50, default 5).' },
        from: { type: 'string', description: 'Optional ISO-8601 start time (default: now).' },
      },
      required: ['expression'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const expr = reqStr(args, 'expression', '"0 9 * * 1-5"');
  let p: ReturnType<typeof parse>;
  try { p = parse(expr); } catch (e) { return { input: expr, valid: false, error: (e as Error).message }; }

  if (name === 'describe_cron') {
    return { input: expr, valid: true, normalized: p.fields.join(' '), description: describe(p), fields: { minute: p.minute, hour: p.hour, day_of_month: p.dom, month: p.month, day_of_week: p.dow } };
  }
  if (name === 'next_runs') {
    const count = Math.max(1, Math.min(50, typeof args.count === 'number' ? args.count : 5));
    const fromMs = typeof args.from === 'string' ? Date.parse(args.from) : Date.now();
    if (!Number.isFinite(fromMs)) return { input: expr, error: `Could not parse "from" time.` };
    let t = Math.ceil(fromMs / 60000) * 60000; // next whole minute
    const runs: string[] = [];
    let guard = 0;
    const CAP = 6_000_000; // ~11 years of minutes
    while (runs.length < count && guard < CAP) {
      const d = new Date(t);
      if (matches(p, d)) runs.push(d.toISOString().replace('.000Z', 'Z'));
      t += 60000; guard++;
    }
    return { input: expr, description: describe(p), from: new Date(fromMs).toISOString(), next_runs: runs, ...(runs.length < count ? { note: 'Fewer runs than requested within the search window.' } : {}) };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function reqStr(args: Record<string, unknown>, key: string, ex: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Required argument "${key}" is missing. Pass a string like ${ex}.`);
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
