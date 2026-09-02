/* 三人同步层（Supabase）。未配置时自动降级为单机，不报错。 */
'use strict';
(function () {
  const cfg = window.APP_CONFIG || {};
  const Sync = { enabled: false, client: null, book: cfg.BOOK || 'home' };

  Sync.init = function () {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) { this.enabled = false; return false; }
    try {
      this.client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        realtime: { params: { eventsPerSecond: 5 } },
      });
      this.enabled = true; return true;
    } catch (e) { console.warn('Sync init failed', e); this.enabled = false; return false; }
  };

  const toRow = (r, book) => ({ id: r.id, kind: r.kind, amount: r.amount, cat: r.cat, note: r.note, raw: r.raw || r.note, creator_id: r.creatorId, ts: r.ts, no_count: !!r.noCount, book });
  const fromRow = x => ({ id: x.id, kind: x.kind, amount: Number(x.amount), cat: x.cat, note: x.note, raw: x.raw || x.note, creatorId: x.creator_id, ts: Number(x.ts), noCount: !!x.no_count, synced: true });

  Sync.push = async function (rec) {
    if (!this.enabled) return false;
    const { error } = await this.client.from('records').upsert(toRow(rec, this.book));
    if (error) { console.warn('push', error.message); return false; }
    return true;
  };

  Sync.remove = async function (id) {
    if (!this.enabled) return false;
    const { error } = await this.client.from('records').delete().eq('id', id);
    return !error;
  };

  Sync.pull = async function () {
    if (!this.enabled) return null;
    const { data, error } = await this.client.from('records').select('*').eq('book', this.book).order('ts', { ascending: false });
    if (error) { console.warn('pull', error.message); return null; }
    return data.map(fromRow);
  };

  Sync.subscribe = function (onChange) {
    if (!this.enabled) return;
    this.client.channel('records-' + this.book)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: 'book=eq.' + this.book },
        () => { onChange && onChange(); })
      .subscribe();
  };

  /* 定期设定（recur_defs）云同步：让固定支出的“设定”跨设备共享、重装不丢 */
  const defToRow = (d, book) => ({ id: d.id, book, name: d.name, amount: d.amount, kind: d.kind, cat: d.cat, period: d.period, day: d.day, month: d.month, creator_id: d.creatorId, start_ts: d.startTs });
  const defFromRow = x => ({ id: x.id, name: x.name, amount: Number(x.amount), kind: x.kind, cat: x.cat, period: x.period, day: Number(x.day), month: Number(x.month), creatorId: x.creator_id, startTs: Number(x.start_ts) });

  Sync.pushDef = async function (d) {
    if (!this.enabled) return false;
    const { error } = await this.client.from('recur_defs').upsert(defToRow(d, this.book));
    if (error) { console.warn('pushDef', error.message); return false; }
    return true;
  };
  Sync.removeDef = async function (id) {
    if (!this.enabled) return false;
    const { error } = await this.client.from('recur_defs').delete().eq('id', id);
    return !error;
  };
  Sync.pullDefs = async function () {
    if (!this.enabled) return null;
    const { data, error } = await this.client.from('recur_defs').select('*').eq('book', this.book);
    if (error) { console.warn('pullDefs', error.message); return null; }
    return data.map(defFromRow);
  };
  Sync.subscribeDefs = function (onChange) {
    if (!this.enabled) return;
    this.client.channel('defs-' + this.book)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recur_defs', filter: 'book=eq.' + this.book },
        () => { onChange && onChange(); })
      .subscribe();
  };

  window.Sync = Sync;
})();
