import ts from 'typescript';

// Test-only output. Never replace production Code.gs with this generated source.
// Every service capable of a remote side effect is redirected to a fail-closed
// adapter. No production Script Properties or credentials are copied.
export function buildSandboxSource(source, config) {
  if (!config?.scriptId || !Array.isArray(config.folderIds) || !config.folderIds.length
    || config.folderIds.some(id => !/^[a-zA-Z0-9_-]{10,100}$/.test(id))) throw new Error('SANDBOX_CONFIGURATION_INVALID');
  const services = ['UrlFetchApp', 'GmailApp', 'MailApp', 'DriveApp', 'Drive', 'SpreadsheetApp', 'ScriptApp', 'Session'];
  const tree = ts.createSourceFile('Code.gs', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const transformed = ts.transform(tree, [context => root => {
    function visit(node) {
      if (ts.isStringLiteral(node) && Object.hasOwn(config.folderMap || {}, node.text)) {
        const mapped = config.folderMap[node.text];
        if (!config.folderIds.includes(mapped) || mapped === node.text) throw new Error('SANDBOX_FOLDER_MAP_INVALID');
        return context.factory.createStringLiteral(mapped);
      }
      if (ts.isIdentifier(node) && services.includes(node.text)) return context.factory.createIdentifier(`GncSandbox_${node.text}`);
      return ts.visitEachChild(node, visit, context);
    }
    return ts.visitNode(root, visit);
  }]);
  const output = ts.createPrinter().printFile(transformed.transformed[0]);
  transformed.dispose();
  return `// GNC ISOLATED SANDBOX: ${config.scriptId}\n` +
    `const GNC_SANDBOX_FOLDERS = ${JSON.stringify(config.folderIds)};\n` +
    `const GNC_SANDBOX_NATIVE_DRIVE = DriveApp;\n` +
    `const GNC_SANDBOX_MAIL = [];\n` +
    `function gncSandboxDenied_() { throw new Error('SANDBOX_EXTERNAL_OPERATION_BLOCKED'); }\n` +
    `function gncSandboxFolder_(id) { if (GNC_SANDBOX_FOLDERS.indexOf(String(id)) < 0) return gncSandboxDenied_(); const folder = GNC_SANDBOX_NATIVE_DRIVE.getFolderById(id); return { getId: function(){return folder.getId();}, getName: function(){return folder.getName();}, getFiles: function(){const it=folder.getFiles();return {hasNext:function(){return it.hasNext();},next:function(){return gncSandboxFile_(it.next());}};}, createFile:function(){return gncSandboxFile_(folder.createFile.apply(folder,arguments));} }; }\n` +
    `function gncSandboxFile_(file) { return { getId:function(){return file.getId();},getName:function(){return file.getName();},getBlob:function(){return file.getBlob();},getMimeType:function(){return file.getMimeType();},getLastUpdated:function(){return file.getLastUpdated();},getSize:function(){return file.getSize();},setName:function(name){file.setName(name);return this;},moveTo:function(folder){const id=folder.getId();if(GNC_SANDBOX_FOLDERS.indexOf(id)<0)return gncSandboxDenied_();file.moveTo(GNC_SANDBOX_NATIVE_DRIVE.getFolderById(id));return this;} }; }\n` +
    `const GncSandbox_DriveApp = { getFolderById: gncSandboxFolder_, getFileById: gncSandboxDenied_, getRootFolder: gncSandboxDenied_ };\n` +
    `const GncSandbox_UrlFetchApp = { fetch: gncSandboxDenied_, fetchAll: gncSandboxDenied_ };\n` +
    `const GncSandbox_GmailApp = { sendEmail: function() { GNC_SANDBOX_MAIL.push({ intercepted: true }); }, getAliases: function() { return []; } };\n` +
    `const GncSandbox_MailApp = GncSandbox_GmailApp;\n` +
    `const GncSandbox_Drive = { Files: { create: gncSandboxDenied_, get: gncSandboxDenied_, update: gncSandboxDenied_, remove: gncSandboxDenied_, list: gncSandboxDenied_ } };\n` +
    `const GncSandbox_SpreadsheetApp = { openById: gncSandboxDenied_, open: gncSandboxDenied_, create: gncSandboxDenied_ };\n` +
    `const GncSandbox_ScriptApp = { newTrigger: gncSandboxDenied_, getProjectTriggers: function() { return []; }, deleteTrigger: gncSandboxDenied_, getOAuthToken: gncSandboxDenied_ };\n` +
    `const GncSandbox_Session = { getActiveUser: function() { return { getEmail: function() { return 'fixture@example.invalid'; } }; }, getEffectiveUser: function() { return this.getActiveUser(); } };\n` + output;
}
