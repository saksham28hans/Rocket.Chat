import { Meteor } from 'meteor/meteor';
import { Session } from 'meteor/session';
import _ from 'underscore';
import EventEmitter from 'wolfy87-eventemitter';

import { RoomHistoryManager } from './RoomHistoryManager';
import { RoomManager } from './RoomManager';
import { ChatSubscription, ChatMessage } from '../../../models';
/* DEFINITIONS
- If window loses focus user needs to scroll or click/touch some place
- On hit ESC enable read, force read of current room and remove unread mark
- When user change room disable read until user interaction
- Only read if mark of *first-unread* is visible for user or if flag *force* was passed
- Always read the opened room
- The default method *read* has a delay of 2000ms to prevent multiple reads and to user be able to see the mark
*/

// Meteor.startup ->
// window.addEventListener 'focus', ->
// readMessage.refreshUnreadMark(undefined, true)

export const readMessage = new class extends EventEmitter {
	constructor() {
		super();
		this.debug = false;
		this.read = _.debounce((force) => this.readNow(force), 2000);
		this.enable();
	}

	readNow(force) {
		this.log('--------------');
		this.log('readMessage -> readNow init process force:', force);

		if ((force !== true) && (this.enabled === false)) {
			this.log('readMessage -> readNow canceled by enabled: false');
			return;
		}

		const rid = Session.get('openedRoom');
		if (rid == null) {
			this.log('readMessage -> readNow canceled, no rid informed');
			return;
		}

		if (force === true) {
			this.log('readMessage -> readNow via force rid:', rid);
			return Meteor.call('readMessages', rid, () => {
				RoomHistoryManager.getRoom(rid).unreadNotLoaded.set(0);
				return this.emit(rid);
			});
		}

		const subscription = ChatSubscription.findOne({ rid });
		if (subscription == null) {
			this.log('readMessage -> readNow canceled, no subscription found for rid:', rid);
			return;
		}

		if ((subscription.alert === false) && (subscription.unread === 0)) {
			this.log('readMessage -> readNow canceled, alert', subscription.alert, 'and unread', subscription.unread);
			return;
		}

		const room = RoomManager.getOpenedRoomByRid(rid);
		if (room == null) {
			this.log('readMessage -> readNow canceled, no room found for typeName:', subscription.t + subscription.name);
			return;
		}

		// Only read messages if user saw the first unread message
		const unreadMark = $('.message.first-unread');
		if (unreadMark.length > 0) {
			const position = unreadMark.position();
			const visible = (position != null ? position.top : undefined) >= 0;
			if (!visible && room.unreadSince.get()) {
				this.log('readMessage -> readNow canceled, unread mark visible:', visible, 'unread since exists', room.unreadSince.get() != null);
				return;
			}
		// if unread mark is not visible and there is more more not loaded unread messages
		} else if (RoomHistoryManager.getRoom(rid).unreadNotLoaded.get() > 0) {
			return;
		}

		this.log('readMessage -> readNow rid:', rid);
		Meteor.call('readMessages', rid, () => {
			RoomHistoryManager.getRoom(rid).unreadNotLoaded.set(0);
			return this.emit(rid);
		});
	}

	log(...args) {
		return this.debug && console.log(...args);
	}

	disable() {
		this.enabled = false;
	}

	enable() {
		this.enabled = document.hasFocus();
	}

	isEnable() {
		return this.enabled === true;
	}

	refreshUnreadMark(rid) {
		if (rid == null) {
			return;
		}

		const subscription = ChatSubscription.findOne({ rid }, { reactive: false });
		if (subscription == null) {
			return;
		}

		const room = RoomManager.openedRooms[subscription.t + subscription.name];
		if (room == null) {
			return;
		}

		if (!subscription.alert && (subscription.unread === 0)) {
			const roomDom = $(room.dom);
			roomDom.find('.message.first-unread').removeClass('first-unread');
			room.unreadSince.set(undefined);
			return;
		}

		let lastReadRecord = ChatMessage.findOne({
			rid: subscription.rid,
			ts: {
				$lt: subscription.ls,
			},
		}, {
			sort: {
				ts: -1,
			},
		});
		const { unreadNotLoaded } = RoomHistoryManager.getRoom(rid);

		if (lastReadRecord == null && unreadNotLoaded.get() === 0) {
			lastReadRecord = { ts: new Date(0) };
		}

		room.unreadSince.set((lastReadRecord || unreadNotLoaded.get() > 0) && subscription.ls);

		if (!lastReadRecord) {
			return;
		}

		const firstUnreadRecord = ChatMessage.findOne({
			rid: subscription.rid,
			ts: {
				$gt: lastReadRecord.ts,
			},
			'u._id': {
				$ne: Meteor.userId(),
			},
		}, {
			sort: {
				ts: 1,
			},
		});

		if (firstUnreadRecord) {
			room.unreadFirstId = firstUnreadRecord._id;
			const roomDom = $(room.dom);
			roomDom.find('.message.first-unread').removeClass('first-unread');
			roomDom.find(`.message#${ firstUnreadRecord._id }`).addClass('first-unread');
		}
	}
}();


Meteor.startup(function() {
	$(window)
		.on('blur', () => readMessage.disable())
		.on('focus', () => {
			readMessage.enable();
			readMessage.readNow();
		})
		.on('touchend', () => {
			readMessage.enable();
		})
		.on('keyup', (e) => {
			const key = e.which;
			if (key === 27) { // ESCAPE KEY
				readMessage.readNow(true);
			}
		});
});