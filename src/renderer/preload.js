const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  onLoadJson: (callback) => ipcRenderer.on('load-json', (event, data) => callback(data)),
  saveJson: (filePath, jsonData) => ipcRenderer.invoke('save-json', { filePath, jsonData }),
  onToggleSystemMessages: (callback) => ipcRenderer.on('toggle-system-messages', (event, show) => callback(show)),
  onToggleToolMessages: (callback) => ipcRenderer.on('toggle-tool-messages', (event, show) => callback(show)),
  onFileChanged: (callback) => ipcRenderer.on('file-changed', (event, data) => callback(data)),
  onChatList: (callback) => ipcRenderer.on('chat-list', (event, chats) => callback(chats)),
  loadChat: (filePath) => ipcRenderer.invoke('load-chat', filePath),
  callOpenAI: (filePath) => ipcRenderer.invoke('call-openai', filePath),
  onStreamingUpdate: (callback) => ipcRenderer.on('streaming-update', (event, data) => callback(data)),
  deleteChat: (filePath) => ipcRenderer.invoke('delete-chat', filePath)
}); 