"use strict";
// Agentic OS Sync — keeps this vault and the dashboard's copy of it in step, both ways.
// Notes (.md) and canvases (.canvas) sync; Obsidian's own folders (anything starting with a dot) never do.
// The plugin remembers the hash both sides last agreed on for every note, so on each run it knows which
// side changed: only here → upload, only there → download, both → the dashboard's version keeps the name
// and yours is saved next to it as "(conflict …)", then uploaded too. Nothing is ever silently lost.
const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, TFile, TFolder } = require("obsidian");

const DEFAULTS = { server: "", code: "", everyMin: 5, last: {} };
const SYNCABLE = /\.(md|canvas)$/i;
const hidden = (p) => p.split("/").some((s) => s.startsWith("."));

async function sha256(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

function conflictName(p) {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
  const dot = p.lastIndexOf(".");
  return `${p.slice(0, dot)} (conflict ${stamp})${p.slice(dot)}`;
}

class AgenticSync extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    if (!this.settings.last || typeof this.settings.last !== "object") this.settings.last = {};
    this.running = false;
    this.status = this.addStatusBarItem();
    this.setStatus(this.ready() ? "Agentic OS: waiting" : "Agentic OS: not set up");
    this.addRibbonIcon("refresh-cw", "Sync with Agentic OS", () => this.sync(true));
    this.addCommand({ id: "sync-now", name: "Sync now", callback: () => this.sync(true) });
    this.addSettingTab(new SyncSettings(this.app, this));
    // A change syncs 20 seconds later (edits in a row become one upload); and every few minutes regardless.
    const soon = () => {
      window.clearTimeout(this.debounce);
      this.debounce = window.setTimeout(() => this.sync(false), 20000);
    };
    this.app.workspace.onLayoutReady(() => {
      for (const ev of ["modify", "create", "delete", "rename"]) this.registerEvent(this.app.vault.on(ev, soon));
      this.sync(false);
    });
    this.restartTimer();
  }

  onunload() {
    window.clearTimeout(this.debounce);
  }

  restartTimer() {
    if (this.timer) window.clearInterval(this.timer);
    const min = Math.max(1, Number(this.settings.everyMin) || 5);
    this.timer = window.setInterval(() => this.sync(false), min * 60000);
    this.registerInterval(this.timer);
  }

  ready() {
    return /^https:\/\//.test(this.settings.server) && /^adv_/.test(this.settings.code);
  }

  setStatus(text) {
    this.status.setText(text);
  }

  async api(method, route, opts = {}) {
    const base = this.settings.server.replace(/\/+$/, "");
    const q = new URLSearchParams(opts.query || {}).toString();
    return requestUrl({
      url: `${base}${route}${q ? `?${q}` : ""}`,
      method,
      headers: { Authorization: `Bearer ${this.settings.code}` },
      body: opts.body,
      contentType: opts.body ? "text/markdown" : undefined,
      throw: false,
    });
  }

  async ensureFolder(path) {
    const parts = path.split("/").slice(0, -1);
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      const f = this.app.vault.getAbstractFileByPath(cur);
      if (!f) await this.app.vault.createFolder(cur).catch(() => {});
      else if (!(f instanceof TFolder)) throw new Error(`"${cur}" is a file, not a folder`);
    }
  }

  async writeLocal(path, buf) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.vault.modifyBinary(f, buf);
    else {
      await this.ensureFolder(path);
      await this.app.vault.createBinary(path, buf);
    }
  }

  async pull(path) {
    const r = await this.api("GET", "/api/vault/file", { query: { path } });
    if (r.status !== 200) throw new Error(`download ${path}: ${r.status}`);
    await this.writeLocal(path, r.arrayBuffer);
    return sha256(r.arrayBuffer);
  }

  async sync(byHand) {
    if (this.running) return;
    if (!this.ready()) {
      if (byHand) new Notice("Agentic OS: add the dashboard address and your sync code in Settings → Agentic OS Sync.");
      return;
    }
    this.running = true;
    this.setStatus("Agentic OS: syncing…");
    const last = this.settings.last;
    let up = 0;
    let down = 0;
    let conflicts = 0;
    try {
      const m = await this.api("GET", "/api/vault/manifest");
      if (m.status === 401) throw new Error("the sync code was refused — make a new one in the dashboard's Settings");
      if (m.status !== 200) throw new Error(`the dashboard answered ${m.status}`);
      const remote = new Map(m.json.files.map((f) => [f.path, f.hash]));
      const local = new Map();
      for (const f of this.app.vault.getFiles()) {
        if (!SYNCABLE.test(f.path) || hidden(f.path)) continue;
        local.set(f.path, { file: f, hash: await sha256(await this.app.vault.readBinary(f)) });
      }
      const paths = new Set([...remote.keys(), ...local.keys(), ...Object.keys(last)]);
      for (const p of paths) {
        if (hidden(p) || !SYNCABLE.test(p)) continue;
        const L = local.get(p) ? local.get(p).hash : null;
        const R = remote.has(p) ? remote.get(p) : null;
        const B = last[p] || null;
        try {
          if (L === R) {
            if (L) last[p] = L;
            else delete last[p];
          } else if (L === B) {
            // Only the dashboard changed it.
            if (R === null) {
              await this.app.vault.trash(local.get(p).file, false); // into the vault's .trash, recoverable
              delete last[p];
            } else {
              last[p] = await this.pull(p);
            }
            down++;
          } else if (R === B) {
            // Only this vault changed it.
            if (L === null) {
              const r = await this.api("DELETE", "/api/vault/file", { query: { path: p, base: R } });
              if (r.status === 200) delete last[p];
            } else {
              const body = await this.app.vault.readBinary(local.get(p).file);
              const r = await this.api("PUT", "/api/vault/file", { query: { path: p, base: R || "" }, body });
              if (r.status === 200) last[p] = L;
              else if (r.status === 413) new Notice(`Agentic OS: ${p} wasn't synced (${r.json.error}).`);
            }
            up++;
          } else if (L && R) {
            // Both changed: the dashboard's version keeps the name, this one is kept beside it.
            const mine = await this.app.vault.readBinary(local.get(p).file);
            const copy = conflictName(p);
            await this.ensureFolder(copy);
            await this.app.vault.createBinary(copy, mine);
            last[p] = await this.pull(p);
            conflicts++;
          } else if (L) {
            // Deleted on the dashboard, edited here: keep the edit.
            const body = await this.app.vault.readBinary(local.get(p).file);
            const r = await this.api("PUT", "/api/vault/file", { query: { path: p, base: "" }, body });
            if (r.status === 200) last[p] = L;
            up++;
          } else {
            // Deleted here, edited on the dashboard: bring it back.
            last[p] = await this.pull(p);
            down++;
          }
        } catch (e) {
          console.error("Agentic OS sync:", p, e);
        }
      }
      await this.saveData(this.settings);
      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      this.setStatus(`Agentic OS: synced ${time}`);
      if (byHand || conflicts) new Notice(`Agentic OS: ${up} up, ${down} down${conflicts ? `, ${conflicts} kept as conflict copies` : ""}.`);
    } catch (e) {
      this.setStatus("Agentic OS: sync failed");
      if (byHand) new Notice(`Agentic OS: ${e.message || e}`);
      console.error("Agentic OS sync:", e);
    } finally {
      this.running = false;
    }
  }
}

class SyncSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();
    containerEl.createEl("p", { text: "Your dashboard reads these notes and writes your journal, goals and memory into them." });
    new Setting(containerEl)
      .setName("Dashboard address")
      .setDesc("For example https://agents.example.com")
      .addText((t) =>
        t.setPlaceholder("https://…").setValue(s.server).onChange(async (v) => {
          s.server = v.trim();
          s.last = {};
          await this.plugin.saveData(s);
        }),
      );
    new Setting(containerEl)
      .setName("Sync code")
      .setDesc("From the dashboard: Settings → Obsidian → New sync code.")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("adv_…").setValue(s.code).onChange(async (v) => {
          s.code = v.trim();
          await this.plugin.saveData(s);
        });
      });
    new Setting(containerEl)
      .setName("Sync every (minutes)")
      .addText((t) =>
        t.setValue(String(s.everyMin)).onChange(async (v) => {
          s.everyMin = Math.max(1, Math.min(60, Number(v) || 5));
          await this.plugin.saveData(s);
          this.plugin.restartTimer();
        }),
      );
    new Setting(containerEl).setName("Sync now").addButton((b) => b.setButtonText("Sync").setCta().onClick(() => this.plugin.sync(true)));
  }
}

module.exports = AgenticSync;
