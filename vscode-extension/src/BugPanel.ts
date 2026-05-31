import * as vscode from "vscode"
import { Bug, fetchRandomBug } from "./api"

export class BugPanel {
  static currentPanel: BugPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private bug: Bug | null = null
  private token: string

  constructor(panel: vscode.WebviewPanel, token: string) {
    this.panel = panel
    this.token = token
    this.panel.onDidDispose(() => { BugPanel.currentPanel = undefined }, null, [])
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === "answer") {
        const correct = msg.answer === this.bug?.options.findIndex((_, i) => i === msg.correctIndex)
        // For practice, just show result
        await this.panel.webview.postMessage({ command: "reveal", correct, explanation: this.bug?.explanation })
      }
      if (msg.command === "next") { await this.loadBug() }
    })
    this.loadBug()
  }

  async loadBug() {
    const lang = vscode.window.activeTextEditor?.document.languageId
    this.bug = await fetchRandomBug(this.token, lang)
    if (this.bug) this.panel.webview.html = this.getHtml(this.bug)
  }

  getHtml(bug: Bug): string {
    const opts = bug.options.map((o, i) => `<button onclick="answer(${i})" class="opt">${"ABCD"[i]}. ${o}</button>`).join("")
    return `<!DOCTYPE html><html><body style="background:#0f172a;color:white;font-family:monospace;padding:20px">
      <h2>BugHunt Practice</h2>
      <p>Language: ${bug.language} | Difficulty: ${"★".repeat(bug.difficulty)}</p>
      <pre style="background:#1e293b;padding:12px;border-radius:6px;overflow:auto">${bug.buggyCode}</pre>
      <div id="opts">${opts}</div>
      <div id="result" style="display:none"></div>
      <style>.opt{display:block;margin:6px 0;padding:8px;background:#1e293b;border:1px solid #334155;color:white;cursor:pointer;border-radius:4px;width:100%;text-align:left}.opt:hover{background:#334155}</style>
      <script>const vscode=acquireVsCodeApi();function answer(i){vscode.postMessage({command:"answer",answer:i})}
      window.addEventListener("message",e=>{if(e.data.command==="reveal"){document.getElementById("result").style.display="block";document.getElementById("result").innerHTML="<p style='color:"+(e.data.correct?"#4ade80":"#f87171")+"'>"+(e.data.correct?"Correct!":"Wrong")+"</p><p>"+e.data.explanation+"</p><button onclick='vscode.postMessage({command:\"next\"})' style='margin-top:10px;padding:8px 16px;background:#4ade80;color:#0f172a;border:none;border-radius:4px;cursor:pointer'>Next Bug</button>"}})</script>
      </body></html>`
  }

  static create(token: string) {
    const panel = vscode.window.createWebviewPanel("bughunt", "BugHunt Practice", vscode.ViewColumn.Two, { enableScripts: true })
    BugPanel.currentPanel = new BugPanel(panel, token)
  }
}
