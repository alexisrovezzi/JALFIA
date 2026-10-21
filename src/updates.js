/* GitHub requests contain only public repository identifiers. */
(function (scope) {
  const REPO = 'https://github.com/alexisrovezzi/JALFIA';
  const API = 'https://api.github.com/repos/alexisrovezzi/JALFIA';
  const KEY = 'jalfiaUpdateCache', HOUR = 3600000;
  function create({ storage, fetcher, installed, now = Date.now }) {
    let pending;
    async function cached() {
      const cache = (await storage.get(KEY))[KEY] || {};
      return cache.installedCommit === installed.commit ? cache : {};
    }
    async function check(force = false) {
      if (pending) return pending;
      pending = (async () => {
        const cache = await cached();
        if (!force && cache.lastAttempt && now() - cache.lastAttempt < HOUR) return cache;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        async function api(route) {
          const response = await fetcher(API + route, { signal: controller.signal, credentials: 'omit', headers: { Accept: 'application/vnd.github+json' } });
          if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'GitHub limitó las consultas. Reintentá más tarde.' : `No se pudo consultar GitHub (${response.status}).`);
          return response.json();
        }
        const lastAttempt = now();
        try {
          const candidates = new Map();
          for (let page = 1; ; page++) {
            const releases = await api(`/releases?per_page=100&page=${page}`);
            for (const release of releases) {
              if (release.draft || !release.prerelease || !/^dev-[a-f0-9]{40}$/.test(release.tag_name)) continue;
              const commit = release.tag_name.slice(4);
              const asset = release.assets?.find(item => new RegExp(`^JALFIA-(\\d+\\.\\d+\\.\\d+(?:\\.\\d+)?)-${commit.slice(0, 7)}\\.zip$`).test(item.name) && item.state === 'uploaded');
              if (!asset || asset.browser_download_url !== `${REPO}/releases/download/${release.tag_name}/${asset.name}`) continue;
              candidates.set(commit, { commit, version: asset.name.slice(7, -(commit.slice(0, 7).length + 5)), download: asset.browser_download_url, url: `${REPO}/releases/tag/${release.tag_name}` });
            }
            if (releases.length < 100) break;
          }
          // Walk main newest first: one request per history page, rather than
          // two requests for every release ever published (public API quota).
          let publication = null;
          if (candidates.size) {
            for (let page = 1; ; page++) {
              const commits = await api(`/commits?sha=main&per_page=100&page=${page}`);
              const matches = commits.filter(item => candidates.has(item.sha));
              matches.sort((a, b) => Date.parse(b.commit.committer.date) - Date.parse(a.commit.committer.date));
              if (matches.length) {
                const newest = matches[0];
                publication = { ...candidates.get(newest.sha), date: newest.commit.committer.date };
                break;
              }
              if (commits.length < 100) break;
            }
          }
          let status = 'unavailable';
          if (!installed.commit) status = 'unknown';
          else if (publication) {
            if (installed.commit === publication.commit) status = 'identical';
            else {
              const comparison = await api(`/compare/${installed.commit}...${publication.commit}`);
              status = ({ ahead: 'available', behind: 'ahead', diverged: 'diverged', identical: 'identical' })[comparison.status] || 'unknown';
            }
          }
          const result = { installedCommit: installed.commit, lastAttempt, checkedAt: now(), status, publication, error: null };
          await storage.set({ [KEY]: result }); return result;
        } catch (error) {
          const result = { ...cache, installedCommit: installed.commit, lastAttempt, error: error.name === 'AbortError' ? 'GitHub no respondió en diez segundos.' : error.message };
          await storage.set({ [KEY]: result }); return result;
        } finally { clearTimeout(timer); }
      })();
      try { return await pending; } finally { pending = null; }
    }
    return { check, cached };
  }
  scope.JalfiaUpdates = { create, REPO };
  if (typeof module !== 'undefined') module.exports = scope.JalfiaUpdates;
})(globalThis);
