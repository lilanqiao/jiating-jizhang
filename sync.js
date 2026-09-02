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

  const toRow = (r, book) => ({ id: r.id, kind: r.kind, amount: r.amount, cat: r.cat, note: r.note, creator_id: r.creatorId, ts: r.ts, book });
  const fromRow = x => ({ id: x.id, kind: x.kind, amount: Number(x.amount), cat: x.cat, note: x.note, creatorId: x.creator_id, ts: Number(x.ts), synced: true });

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

  window.Sync = Sync;
})();
