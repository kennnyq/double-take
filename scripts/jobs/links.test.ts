import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, videoLink } from './links.ts';
test('link policy rejects credentials, schemes, private literals and social pages', () => {
  for (const value of ['file:///etc/passwd', 'http://example.com/a.mp4', 'https://user:pass@example.com/a', 'https://127.1/a', 'https://[::1]/a', 'https://2130706433/a', 'https://example.com:8443/a', 'https://host.local/a', 'https://youtube.com/watch?v=x', 'https://www.tiktok.com/@user/video/1', 'https://x.com/a/status/1', 'https://reddit.com/r/a', 'https://example.com/a#x']) assert.throws(() => videoLink(value), value);
  assert.equal(videoLink('https://media.example.com/a.mp4?token=x').hostname, 'media.example.com');
});
test('address policy rejects private, metadata, mapped, multicast and reserved ranges', () => {
  for (const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.0.1','169.254.169.254','100.100.100.200','0.0.0.0','224.0.0.1','198.18.0.1','192.0.2.1','203.0.113.1','::1','::ffff:127.0.0.1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('93.184.216.34'), true);
});
