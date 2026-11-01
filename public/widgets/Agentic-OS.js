// Scriptable iPhone Home Screen widget. No credentials belong in this file.
// Widget parameter: today (default), goals, or focus. Size follows the widget.
const origin = "https://agents.383ks.com";
const tokenKey = "agent-dashboard.widget-read-token";
const view = String(args.widgetParameter || "today").trim().toLowerCase();
const size = config.widgetFamily || "medium";
const widget = new ListWidget();
widget.backgroundColor = new Color("#08090b");
widget.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);

try {
  if (!["today", "goals", "focus"].includes(view) || !["small", "medium", "large"].includes(size)) {
    throw new Error("Use a small, medium or large widget with parameter today, goals or focus.");
  }
  if (!Keychain.contains(tokenKey) && config.runsInApp) {
    const setup = new Alert();
    setup.title = "Connect Agentic OS";
    setup.message = "Paste your existing widget read token. It stays in Scriptable Keychain.";
    setup.addSecureTextField("Widget read token");
    setup.addAction("Connect");
    setup.addCancelAction("Cancel");
    if (await setup.presentAlert() === -1) return;
    const value = setup.textFieldValue(0).trim();
    if (value.length < 32 || /\s/.test(value)) throw new Error("Enter the existing widget read token.");
    Keychain.set(tokenKey, value);
  }
  if (!Keychain.contains(tokenKey)) throw new Error("Open this script in Scriptable once to connect.");

  const request = new Request(`${origin}/api/widget/image?view=${view}&size=${size}`);
  request.headers = { Authorization: `Bearer ${Keychain.get(tokenKey)}`, "Cache-Control": "no-cache" };
  request.timeoutInterval = 20;
  // Never log provider errors: they can include request headers or private data.
  let image;
  try {
    image = await request.loadImage();
    if (request.response.statusCode !== 200) throw new Error();
  } catch {
    throw new Error("Refresh failed. Check connection and your widget read token in Scriptable.");
  }
  widget.setPadding(0, 0, 0, 0);
  widget.backgroundImage = image;
  widget.url = `${origin}/${view === "today" ? "" : view}`;
} catch (error) {
  widget.setPadding(16, 16, 16, 16);
  const title = widget.addText("Agentic OS");
  title.textColor = Color.white();
  widget.addSpacer(8);
  const detail = widget.addText(error.message);
  detail.textColor = Color.white();
}

Script.setWidget(widget);
if (config.runsInApp) {
  if (size === "small") await widget.presentSmall();
  else if (size === "large") await widget.presentLarge();
  else await widget.presentMedium();
}
Script.complete();
