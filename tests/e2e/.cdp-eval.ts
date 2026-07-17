const port = process.argv[2] ?? "9232";
const expr = process.argv[3] ?? "JSON.stringify(window.__replayRender ?? 'none')";
const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{
  type: string;
  webSocketDebuggerUrl: string;
}>;
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("no page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise<void>((res, rej) => {
  ws.onopen = () => res();
  ws.onerror = () => rej(new Error("ws fail"));
});
const result = await new Promise<string>((res) => {
  const on = (e: MessageEvent) => {
    const m = JSON.parse(String(e.data));
    if (m.id === 1) {
      ws.removeEventListener("message", on);
      res(JSON.stringify(m.result?.result?.value ?? m.result));
    }
  };
  ws.addEventListener("message", on);
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } }));
});
console.log(result);
ws.close();
