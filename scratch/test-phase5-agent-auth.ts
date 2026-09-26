import { WebSocketServer, WebSocket } from 'ws';

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAgentSecurityTests() {
  console.log('🚀 Starting Agent Security & Authorization Logic Tests...\n');

  // 1. テスト用インメモリ制御ロジックの直接シミュレーション
  // Agent の index.ts と同等の認可判定ロジックをテスト

  interface ExecutionContext {
    clientId?: string;
    userName?: string;
    sessionId?: string;
  }

  let currentExecution: ExecutionContext | null = null;
  const pendingApprovals = new Map<string, {
    toolUseId?: string;
    ownerClientId?: string;
    ownerUserName?: string;
  }>();

  let abortCalls = 0;
  let forwardedApprovals = 0;
  const sentErrors: Array<{ error: string; targetClientId?: string }> = [];

  function handleAbort(callerClientId?: string, callerUserName?: string) {
    if (currentExecution) {
      const isMatchClient = currentExecution.clientId && callerClientId && currentExecution.clientId === callerClientId;
      const isMatchUser = currentExecution.userName && callerUserName && currentExecution.userName === callerUserName;
      const isUnrestricted = !currentExecution.clientId && !currentExecution.userName;

      if (!isMatchClient && !isMatchUser && !isUnrestricted) {
        sentErrors.push({
          error: '実行中タスクの中断権限がありません（タスク実行者または同一ユーザーのみ操作可能です）',
          targetClientId: callerClientId
        });
        return false;
      }
    }
    abortCalls++;
    return true;
  }

  function handleToolApproval(msg: {
    requestId: string;
    behavior: 'allow' | 'deny';
    clientId?: string;
    userName?: string;
  }) {
    const pending = pendingApprovals.get(msg.requestId);
    if (!pending) return false;

    const isMatchClient = pending.ownerClientId && msg.clientId && pending.ownerClientId === msg.clientId;
    const isMatchUser = pending.ownerUserName && msg.userName && pending.ownerUserName === msg.userName;
    const isUnrestricted = !pending.ownerClientId && !pending.ownerUserName;

    if (!isMatchClient && !isMatchUser && !isUnrestricted) {
      sentErrors.push({
        error: 'ツール承認の操作権限がありません（リクエスト発行者または同一ユーザーのみ操作可能です）',
        targetClientId: msg.clientId
      });
      return false;
    }

    forwardedApprovals++;
    pendingApprovals.delete(msg.requestId);
    return true;
  }

  // --- Scenario A: Client A (Tanaka) starts task ---
  console.log('[Scenario A] Tanaka (Client A) starts an execution...');
  currentExecution = {
    clientId: 'client-A',
    userName: 'Tanaka',
    sessionId: 'session-tanaka-1'
  };
  pendingApprovals.set('req-101', {
    toolUseId: 'tool-bash-1',
    ownerClientId: 'client-A',
    ownerUserName: 'Tanaka'
  });

  // --- Scenario B: Sato (Client B) attempts abort ---
  console.log('[Scenario B] Sato (Client B) attempts to abort Tanaka\'s task...');
  const abortResultB = handleAbort('client-B', 'Sato');
  if (abortResultB === false && abortCalls === 0) {
    console.log('  ✅ PASS: Sato\'s abort attempt was rejected.');
  } else {
    throw new Error('FAIL: Sato was able to abort Tanaka\'s task!');
  }

  // --- Scenario C: Sato (Client B) attempts tool approval hijack ---
  console.log('[Scenario C] Sato (Client B) attempts to approve Tanaka\'s tool approval request...');
  const approvalResultB = handleToolApproval({
    requestId: 'req-101',
    behavior: 'allow',
    clientId: 'client-B',
    userName: 'Sato'
  });
  if (approvalResultB === false && forwardedApprovals === 0) {
    console.log('  ✅ PASS: Sato\'s approval attempt was rejected.');
  } else {
    throw new Error('FAIL: Sato was able to approve Tanaka\'s tool request!');
  }

  // --- Scenario D: Tanaka from mobile client A2 (same userName) performs abort/approval ---
  console.log('[Scenario D] Tanaka from Mattermost/Mobile (Client A2, userName Tanaka) approves tool...');
  const approvalResultA2 = handleToolApproval({
    requestId: 'req-101',
    behavior: 'allow',
    clientId: 'client-A2',
    userName: 'Tanaka'
  });
  if (approvalResultA2 === true && forwardedApprovals === 1) {
    console.log('  ✅ PASS: Tanaka\'s second client (same user) was permitted to approve tool.');
  } else {
    throw new Error('FAIL: Tanaka\'s second client was rejected unexpectedly!');
  }

  console.log('[Scenario E] Tanaka (Client A) aborts task...');
  const abortResultA = handleAbort('client-A', 'Tanaka');
  if (abortResultA === true && abortCalls === 1) {
    console.log('  ✅ PASS: Original task owner Tanaka successfully aborted task.');
  } else {
    throw new Error('FAIL: Original task owner Tanaka could not abort task!');
  }

  console.log('\n=============================================');
  console.log('🎉 ALL AGENT AUTHORIZATION TESTS PASSED!');
  console.log('=============================================\n');
}

runAgentSecurityTests().catch((err) => {
  console.error('❌ Tests failed:', err);
  process.exit(1);
});
