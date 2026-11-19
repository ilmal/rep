/* Web push handlers. Loaded into the Workbox service worker with importScripts('push-sw.js') (see vite.config.ts), so it
   shares the SW global scope: it only adds 'push' and 'notificationclick' listeners and must not touch caching/precache.
   Payload (JSON, from src/server/ext/push.ts): { type, title, body, tag, url, badge?, ts }.
   type 'streak' (reminders): url is /app/ (risk + repair are states of Today) or /app/streak (streak lost); the generic click handler below
   opens/focuses the app at that route (screens: Streak /streak, Badges /streak/badges, Celebrate /streak/celebrate). */
(function () {
  var ICON = '/app/icon-192.png';
  var APP = '/app/';

  function parse(event) {
    var d = {};
    try { d = event.data ? event.data.json() : {}; } catch (e) {
      try { d = { body: event.data.text() }; } catch (e2) { d = {}; }
    }
    return d && typeof d === 'object' ? d : {};
  }

  /* only ever open pages of this app: never trust a URL from a payload blindly */
  function target(url) {
    try {
      var u = new URL(typeof url === 'string' ? url : APP, self.location.origin);
      if (u.origin === self.location.origin && u.pathname.indexOf(APP) === 0) return u.pathname + u.search;
    } catch (e) { /* fall through */ }
    return APP;
  }

  self.addEventListener('push', function (event) {
    var d = parse(event);
    var tasks = [];
    /* A visible notification is mandatory for every push (userVisibleOnly); iOS revokes the subscription otherwise. */
    tasks.push(self.registration.showNotification(typeof d.title === 'string' && d.title ? d.title : 'Gym Tracker', {
      body: typeof d.body === 'string' ? d.body : '',
      icon: ICON,
      badge: ICON,
      tag: typeof d.tag === 'string' && d.tag ? d.tag : 'gym-tracker',
      renotify: true,
      timestamp: typeof d.ts === 'number' ? d.ts : Date.now(),
      data: { url: target(d.url), type: d.type || '' },
    }));
    if (typeof d.badge === 'number' && self.navigator && typeof self.navigator.setAppBadge === 'function') {
      tasks.push((d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(function () {}));
    }
    event.waitUntil(Promise.all(tasks));
  });

  self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    var url = target(event.notification.data && event.notification.data.url);
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
        for (var i = 0; i < list.length; i++) {
          var c = list[i];
          if (c.url.indexOf(self.location.origin + APP) === 0) {
            /* reuse the open app window: focus it, then route it (navigate() is not available everywhere) */
            return c.focus().then(function (f) {
              var w = f || c;
              if ('navigate' in w) return w.navigate(url).catch(function () { w.postMessage({ type: 'push-open', url: url }); });
              w.postMessage({ type: 'push-open', url: url });
            });
          }
        }
        return self.clients.openWindow(url);
      })
    );
  });
})();
