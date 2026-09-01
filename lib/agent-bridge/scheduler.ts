import {
  getAgentBridgeConfig,
  watchAgentBridgeConfig,
  type AgentBridgeConfig,
} from '@/lib/storage/agent-bridge';
import type {
  AgentBridgeCloseReason,
  AgentBridgeConnectTrigger,
} from './client';

export const AGENT_BRIDGE_ALARM = 'agent-bridge-poll';
// Chrome 116-119 clamps 0.5 minutes to a 60-second alarm; the daemon's
// hello wait must cover that effective period plus handshake margin.
export const AGENT_BRIDGE_POLL_MINUTES = 0.5;

export interface AgentBridgeSchedulerClient {
  tryConnect(trigger?: AgentBridgeConnectTrigger): Promise<void>;
  close(reason: AgentBridgeCloseReason): Promise<void>;
}

interface AgentBridgeSchedulerDependencies {
  getConfig(): Promise<AgentBridgeConfig>;
  watchConfig(listener: () => void): () => void;
  alarms: {
    create(name: string, info: { periodInMinutes: number }): Promise<void>;
    clear(name: string): Promise<boolean>;
    onAlarm: {
      addListener(listener: (alarm: { name: string }) => void): void;
    };
  };
  startup: {
    addListener(listener: () => void): void;
  };
}

export interface AgentBridgeScheduler {
  connectNow(): Promise<void>;
}

export function initAgentBridgeScheduler(
  client: AgentBridgeSchedulerClient,
  dependencies: AgentBridgeSchedulerDependencies = {
    getConfig: getAgentBridgeConfig,
    watchConfig: watchAgentBridgeConfig,
    alarms: browser.alarms,
    startup: browser.runtime.onStartup,
  },
): AgentBridgeScheduler {
  let queue = Promise.resolve();

  const enqueueRefresh = (
    reconfigure: boolean,
    trigger: AgentBridgeConnectTrigger,
  ): Promise<void> => {
    queue = queue
      .then(() => refresh(reconfigure, trigger))
      .catch((error) => console.error('[agent-bridge] scheduler refresh failed', error));
    return queue;
  };

  const refresh = async (
    reconfigure: boolean,
    trigger: AgentBridgeConnectTrigger,
  ): Promise<void> => {
    const config = await dependencies.getConfig();
    if (!config.enabled) {
      await client.close('disabled');
      await dependencies.alarms.clear(AGENT_BRIDGE_ALARM);
      return;
    }

    if (reconfigure) await client.close('config-changed');
    await dependencies.alarms.create(AGENT_BRIDGE_ALARM, {
      periodInMinutes: AGENT_BRIDGE_POLL_MINUTES,
    });
    await client.tryConnect(trigger);
  };

  dependencies.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AGENT_BRIDGE_ALARM) {
      void client.tryConnect('schedule').catch((error) =>
        console.error('[agent-bridge] alarm connection failed', error),
      );
    }
  });
  dependencies.startup.addListener(() => void enqueueRefresh(false, 'schedule'));
  dependencies.watchConfig(() => void enqueueRefresh(true, 'schedule'));
  void enqueueRefresh(false, 'schedule');

  return {
    connectNow: () => enqueueRefresh(false, 'user'),
  };
}
