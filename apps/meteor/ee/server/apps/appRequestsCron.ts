import { Meteor } from 'meteor/meteor';
import { SyncedCron } from 'meteor/littledata:synced-cron';

import { settings } from '../../../app/settings/server';
import { Apps } from './orchestrator';
import { getWorkspaceAccessToken } from '../../../app/cloud/server';
import { appRequestNotififyForUsers } from './marketplace/appRequestNotifyUsers';
import { fetch } from '../../../server/lib/http/fetch';

const appsNotifyAppRequests = Meteor.bindEnvironment(async function _appsNotifyAppRequests() {
	try {
		const installedApps = Promise.await(Apps.installedApps({ enabled: true }));
		if (!installedApps || installedApps.length === 0) {
			return;
		}

		const workspaceUrl = settings.get<string>('Site_Url');
		const token = Promise.await(getWorkspaceAccessToken());

		if (!token) {
			Apps.debugLog(`could not load workspace token to send app requests notifications`);
			return;
		}

		const baseUrl = Apps.getMarketplaceUrl();
		if (!baseUrl) {
			Apps.debugLog(`could not load marketplace base url to send app requests notifications`);
			return;
		}

		const options = {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		};

		const pendingSentUrl = `${baseUrl}/v1/app-request/sent/pending`;
		const result = await fetch(pendingSentUrl, options);
		const data = (await result.json()).data?.data;
		const filtered = installedApps.filter((app) => data.indexOf(app.getID()) !== -1);

		filtered.forEach((app) => {
			const appId = app.getID();
			const appName = app.getName();

			const usersNotified = Promise.await<(string | Error)[]>(
				appRequestNotififyForUsers(baseUrl, workspaceUrl, appId, appName)
					.then(async (response) => {
						// Mark all app requests as sent
						await fetch(`${baseUrl}/v1/app-request/markAsSent/${appId}`, { ...options, method: 'POST' });
						return response;
					})
					.catch((err) => {
						Apps.debugLog(`could not send app request notifications for app ${appId}. Error: ${err}`);
						return err;
					}),
			);

			const errors = usersNotified.filter((batch) => batch instanceof Error);
			if (errors.length > 0) {
				Apps.debugLog(`Some batches of users could not be notified for app ${appId}. Errors: ${errors}`);
			}
		});
	} catch (err) {
		Apps.debugLog(err);
	}
});

// Scheduling as every 12 hours to avoid multiple instances hiting the marketplace at the same time
SyncedCron.add({
	name: 'Apps-Request-End-Users:notify',
	schedule: (parser) => parser.text('every 12 hours'),
	async job() {
		await appsNotifyAppRequests();
	},
});
