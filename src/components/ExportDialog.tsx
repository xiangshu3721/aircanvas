import { useEffect, useState } from 'react';
import { Modal } from './Panels';

interface Props {
  cameraAvailable: boolean;
  render(includeCamera: boolean): Promise<Blob>;
  onSave(blob: Blob): Promise<'shared' | 'downloaded' | 'cancelled' | 'manual'>;
  onClose(): void;
}

/** 保存弹层：预览 + 可选包含摄像头画面 + 保存（手机也可长按图片保存） */
export function ExportDialog({ cameraAvailable, render, onSave, onClose }: Props) {
  const [includeCamera, setIncludeCamera] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let alive = true;
    let u = '';
    render(includeCamera)
      .then((b) => {
        if (!alive) return;
        u = URL.createObjectURL(b);
        setBlob(b);
        setUrl(u);
      })
      .catch(() => alive && setMsg('生成图片失败，请重试'));
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [includeCamera, render]);

  const save = async () => {
    if (!blob) return;
    const r = await onSave(blob);
    if (r === 'downloaded') setMsg('已保存到下载文件夹 ✓');
    else if (r === 'shared') setMsg('已打开分享 ✓');
    else if (r === 'manual') setMsg('请长按上面的图片，选择「存储到照片」');
  };

  return (
    <Modal onClose={onClose} className="export" testId="export-dialog">
      <h2>保存作品</h2>
      <div className="export-preview">{url ? <img src={url} alt="作品预览，手机上可长按保存" data-testid="export-img" /> : <span className="spinner" />}</div>
      {cameraAvailable && (
        <label className="check">
          <input type="checkbox" checked={includeCamera} onChange={(e) => setIncludeCamera(e.target.checked)} data-testid="include-camera" />
          包含摄像头画面
        </label>
      )}
      <button className="btn-primary wide" onClick={save} disabled={!blob} data-testid="export-save">
        保存图片
      </button>
      <p className="export-tip">{msg || '手机上也可以长按图片保存'}</p>
    </Modal>
  );
}
