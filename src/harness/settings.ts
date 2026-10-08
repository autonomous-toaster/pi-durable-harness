/**
 * Harness run policy read live from pi's settings (tasks 6.1, 8.1). Getters are
 * read at every use, so changing a setting applies from the next use without a
 * restart, exactly as pi reads its settings file.
 */
import type { HarnessSettings } from "@earendil-works/pi-durable";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";

export function createHarnessSettings(settings: SettingsManager): HarnessSettings {
	return {
		get stream() {
			const provider = settings.getProviderRetrySettings() as {
				timeoutMs?: number;
				maxRetryDelayMs?: number;
				maxRetries?: number;
			};
			const idle = settings.getHttpIdleTimeoutMs();
			return {
				timeoutMs: provider.timeoutMs ?? (idle === 0 ? 2_147_483_647 : idle),
				...(provider.maxRetryDelayMs === undefined ? {} : { maxRetryDelayMs: provider.maxRetryDelayMs }),
				...(provider.maxRetries === undefined ? {} : { maxRetries: provider.maxRetries }),
			};
		},
		get compaction() {
			return settings.getCompactionSettings();
		},
		get retry() {
			return settings.getRetrySettings();
		},
		get steeringMode() {
			return settings.getSteeringMode();
		},
		get followUpMode() {
			return settings.getFollowUpMode();
		},
	};
}
