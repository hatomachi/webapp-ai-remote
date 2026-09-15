/**
 * Relay Hub (社内AWS EC2常駐中継サーバ)
 * 
 * 役割:
 * 1. Nginxの裏でWebSocket接続を受付（/ws/agent, /ws/client）
 * 2. 社内PC（Agent）と会社スマホ（PWA Client）をペアリング
 * 3. ステートレスにJSONストリームを相互パススルー
 */

console.log('Relay Hub placeholder initialized.');
