var TEST_MAIL_RECIPIENT = 'dylan_collyge@greenleafnursery.com';
function authorizeAgDataTestEmail() { return { quota: MailApp.getRemainingDailyQuota(), recipient: TEST_MAIL_RECIPIENT }; }
function doGet() { return json_({ environment: 'agdata-test', emailAuthorization: MailApp.getRemainingDailyQuota() >= 0 ? 'verified' : 'unavailable', emailsSent: 0 }); }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function doPost(event) {
  var lock = LockService.getScriptLock();
  try {
    var envelope = JSON.parse(event.postData.contents || '{}');
    var properties = PropertiesService.getScriptProperties();
    var secret = properties.getProperty('TEST_MAIL_SIGNING_SECRET');
    if (!secret || Math.abs(Date.now() - Number(envelope.timestamp)) > 300000) return json_({ ok: false, code: 'SIGNATURE_EXPIRED' });
    var canonical = String(envelope.timestamp) + '\n' + String(envelope.eventId) + '\n' + String(envelope.body);
    var signature = Utilities.computeHmacSha256Signature(canonical, secret).map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    var received = String(envelope.signature || ''); var difference = signature.length ^ received.length;
    for (var i = 0; i < signature.length; i++) difference |= signature.charCodeAt(i) ^ (received.charCodeAt(i) || 0);
    if (difference || !/^[0-9a-f-]{36}$/.test(envelope.eventId)) return json_({ ok: false, code: 'INVALID_SIGNATURE' });
    var mail = JSON.parse(envelope.body);
    var attachments=[];if(mail.pdf){var bytes=Utilities.base64Decode(mail.pdf);if(bytes.slice(0,5).map(function(b){return String.fromCharCode(b);}).join('')!=='%PDF-')return json_({ok:false,code:'INVALID_REPORT_PDF'});attachments.push(Utilities.newBlob(bytes,'application/pdf','AgData-Test-Report.pdf'));}
    if(mail.mode==='verify_report')return json_({ok:true,environment:'agdata-test',pdfBytes:mail.pdf?bytes.length:0,emailsSent:0});
    lock.waitLock(10000);
    var key = 'delivery:' + envelope.eventId, existing = properties.getProperty(key);
    if (existing) {
      var receipt = JSON.parse(existing);
      return json_(receipt.status === 'SENT' ? receipt : { ok: false, status: 'REVIEW', code: 'DELIVERY_REVIEW_REQUIRED', eventId: envelope.eventId });
    }
    if (MailApp.getRemainingDailyQuota() < 1) return json_({ ok: false, code: 'MAIL_QUOTA_RETRY' });
    var pending = { status: 'SENDING', eventId: envelope.eventId, startedAt: new Date().toISOString() };
    properties.setProperty(key, JSON.stringify(pending));
    MailApp.sendEmail({ to: TEST_MAIL_RECIPIENT, subject: '[AgData Test] ' + String(mail.subject || 'Operational update').slice(0, 180), body: String(mail.text || ''), htmlBody: String(mail.html || ''), name: 'AgData Test (T)', attachments: attachments });
    var sent = { ok: true, status: 'SENT', eventId: envelope.eventId, recipient: TEST_MAIL_RECIPIENT, sentAt: new Date().toISOString(), transport: 'MailApp' };
    properties.setProperty(key, JSON.stringify(sent));
    return json_(sent);
  } catch (error) { return json_({ ok: false, code: 'DELIVERY_RETRY_OR_REVIEW' }); }
  finally { if (lock.hasLock()) lock.releaseLock(); }
}
