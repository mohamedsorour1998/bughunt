import * as vscode from "vscode"
import { BugPanel } from "./BugPanel"

export function activate(context: vscode.ExtensionContext) {
  const getToken = async (): Promise<string | undefined> => {
    let token = context.globalState.get<string>("bughunt.token")
    if (!token) {
      token = await vscode.window.showInputBox({ prompt: "Enter your BugHunt API token (get it from your profile page)", password: true })
      if (token) await context.globalState.update("bughunt.token", token)
    }
    return token
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("bughunt.startPractice", async () => {
      const token = await getToken()
      if (token) BugPanel.create(token)
    }),
    vscode.commands.registerCommand("bughunt.dailyChallenge", async () => {
      const token = await getToken()
      if (token) BugPanel.create(token)
    }),
    vscode.commands.registerCommand("bughunt.myStats", async () => {
      vscode.env.openExternal(vscode.Uri.parse("https://bughunt.vercel.app/profile"))
    }),
  )
}

export function deactivate() {}
