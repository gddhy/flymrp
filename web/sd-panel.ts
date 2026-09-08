import { listSdFiles, removeSdFile, saveSdFile, sdPath } from './sd-card.ts';

export function setupSdPanel(update: (path: string, bytes: Uint8Array | null) => void): { refresh: () => Promise<void> } {
  const input = document.querySelector<HTMLInputElement>('#sd-files')!;
  const directory = document.querySelector<HTMLInputElement>('#sd-directory')!;
  const status = document.querySelector<HTMLElement>('#sd-status')!;
  const list = document.querySelector<HTMLElement>('#sd-list')!;
  const player = document.querySelector<HTMLAudioElement>('#sd-preview')!;
  let previewUrl: string | null = null;
  function stopPreview() {
    player.pause(); player.removeAttribute('src'); player.load(); player.hidden = true;
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null;
  }
  async function render() {
    const files = await listSdFiles(); list.replaceChildren();
    for (const file of files.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))) {
      const row = document.createElement('li'), label = document.createElement('span');
      label.textContent = `${file.path} · ${(file.bytes.length / 1024).toFixed(1)} KB`; row.append(label);
      if (/\.(mp3|wav|ogg|m4a)$/i.test(file.path)) {
        const play = document.createElement('button'); play.textContent = '试听'; play.ariaLabel = `试听 ${file.path}`;
        play.onclick = () => {
          stopPreview(); previewUrl = URL.createObjectURL(new Blob([file.bytes.slice().buffer as ArrayBuffer]));
          player.src = previewUrl; player.hidden = false;
          void player.play().catch(error => { status.textContent = `无法播放：${String(error)}`; });
        }; row.append(play);
      }
      const remove = document.createElement('button'); remove.textContent = '删除'; remove.ariaLabel = `删除 ${file.path}`;
      remove.onclick = async () => {
        remove.disabled = true;
        try { await removeSdFile(file.path); update(file.path, null); stopPreview(); await render(); status.textContent = `已删除 ${file.path}`; }
        catch (error) { status.textContent = `删除失败：${String(error)}`; remove.disabled = false; }
      }; row.append(remove); list.append(row);
    }
    if (!files.length) { const empty = document.createElement('li'); empty.textContent = '还没有上传文件'; list.append(empty); }
  }
  input.addEventListener('change', async () => {
    const files = Array.from(input.files ?? []); input.value = ''; input.disabled = true;
    let saved = 0;
    try {
      for (const file of files) {
        const path = sdPath(directory.value, file.name), bytes = new Uint8Array(await file.arrayBuffer());
        await saveSdFile({ path, bytes, modified: file.lastModified }); update(path, bytes); saved++;
      }
      status.textContent = `已保存 ${saved} 个文件，可在应用中打开对应目录；部分应用需要重新扫描或重启。`;
    } catch (error) { status.textContent = `已保存 ${saved} 个文件，其余保存失败：${String(error)}`; }
    finally { input.disabled = false; await render().catch(() => {}); }
  });
  void render().catch(error => { status.textContent = `无法读取浏览器存储：${String(error)}`; });
  window.addEventListener('pagehide', stopPreview);
  return { refresh: () => render().catch(() => {}) };
}
