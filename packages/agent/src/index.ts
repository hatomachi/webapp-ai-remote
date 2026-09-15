/**
 * Bridge Agent (社内PC常駐プロセス)
 * 
 * 役割:
 * 1. 社内EC2のRelay Hubへ外向きWebSocket接続を確立・維持
 * 2. スマホからのプロンプト・プロジェクト選択を受信
 * 3. Claude Code を Agent SDK または `claude --output-format stream-json --resume <id>` で実行
 * 4. ツール承認要求（canUseTool / permission_request）をスマホへ中継し、承認応答を待って解決
 */

console.log('Bridge Agent placeholder initialized.');
