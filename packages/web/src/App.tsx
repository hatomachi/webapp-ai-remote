import React from 'react';

export function App() {
  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100">
      <header className="p-4 border-b border-slate-800 flex justify-between items-center">
        <h1 className="text-lg font-bold">📱 AI Remote Cockpit</h1>
        <span className="text-xs px-2 py-1 bg-green-900/60 text-green-400 rounded-full">Connected</span>
      </header>
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="text-sm text-slate-400">セッションを開始してください。</div>
      </main>
      <footer className="p-4 border-t border-slate-800">
        <input 
          type="text" 
          placeholder="Claude Code に指示を入力..." 
          className="w-full bg-slate-800 text-white px-4 py-2 rounded-lg outline-none"
        />
      </footer>
    </div>
  );
}

export default App;
