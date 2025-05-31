import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;
let currentWatcher = null; // Track the current file watcher

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Set up file structure
if (!fs.existsSync(path.join(__dirname, '../../chats')))
  fs.mkdirSync(path.join(__dirname, '../../chats'));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: join(__dirname, '../renderer/preload.js')
    }
  });

  const isMac = process.platform === 'darwin';

  // Create the application menu
  const template = [
    // macOS gets an extra application menu
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),

    /* ----- File ----- */
    {
      label: 'File',
      submenu: [
        {
          label: 'Load JSON…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog({
              title: 'Select a JSON file',
              defaultPath: path.join(__dirname, '../../chats'),
              filters: [{ name: 'JSON Files', extensions: ['json'] }],
              properties: ['openFile']
            });
            if (!canceled && filePaths.length > 0) {
              loadChatFile(filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },

    /* ----- View (existing) ----- */
    {
      label: 'View',
      submenu: [
        {
          label: 'Show System Messages',
          type: 'checkbox',
          checked: true,
          click(item) {
            mainWindow.webContents.send('toggle-system-messages', item.checked);
          }
        },
        {
          label: 'Show Tool Messages',
          type: 'checkbox',
          checked: true,
          click(item) {
            mainWindow.webContents.send('toggle-tool-messages', item.checked);
          }
        },
        { type: 'separator' },
        { role: 'reload' },
        {
          label: 'Toggle Developer Tools',
          accelerator: process.platform === 'darwin' ? 'Cmd+Option+I' : 'Ctrl+Shift+I',
          click(item, focusedWindow) {
            if (focusedWindow) focusedWindow.webContents.toggleDevTools();
          }
        }
      ]
    },

    /* ----- Settings ----- */
    {
      label: 'Settings',
      submenu: [
        // Font menu removed - only using DM Mono now
      ]
    },

    /* ----- Edit / Window / Help stubs (optional) ----- */
    { role: 'editMenu' },
    { role: isMac ? 'windowMenu' : 'help' }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    .catch(err => console.error('Failed to load index.html:', err));

  // Send the list of chat files and load default chat when the window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    sendChatList();
    loadDefaultChat();
  });
}

// Function to load a specific chat file
function loadChatFile(filePath) {
  console.log('Loading chat file:', filePath);
  
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const filename = path.basename(filePath, '.json');
    console.log('Successfully read file:', filename);
    
    mainWindow.webContents.send('load-json', { filename, filePath, data });
    
    // Clear any existing watcher
    if (currentWatcher) {
      currentWatcher.close();
    }
    
    // Set up file watcher for the loaded file
    currentWatcher = fs.watch(filePath, (eventType, filename) => {
      if (eventType === 'change') {
        // Read the updated file
        try {
          const updatedData = fs.readFileSync(filePath, 'utf-8');
          // Send the updated data to the renderer
          mainWindow.webContents.send('file-changed', { 
            filename: path.basename(filePath, '.json'), 
            filePath, 
            data: updatedData 
          });
        } catch (err) {
          console.error('Failed to read updated file:', err);
        }
      }
    });
  } catch (err) {
    console.error('Failed to load chat file:', err);
    // Send an error message to the renderer
    mainWindow.webContents.send('load-json', {
      filename: 'Error',
      filePath: null,
      data: JSON.stringify({
        messages: [{
          role: 'system',
          content: `Error loading file: ${err.message}`
        }]
      })
    });
  }
}

// Function to create a timestamped filename
function createTimestampedFilename() {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[:.]/g, '-')  // Replace colons and periods with hyphens
    .replace('T', '_')      // Replace T with underscore
    .replace('Z', '');      // Remove Z
  return `chat_${timestamp}.json`;
}

// Function to scan and send chat list
function sendChatList() {
  const chatsPath = path.join(__dirname, '../../chats');
  
  fs.readdir(chatsPath, (err, files) => {
    if (err) {
      console.error('Failed to read chats directory:', err);
      mainWindow.webContents.send('chat-list', []);
      return;
    }
    
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    const chatList = [];
    
    // Process each file to get its title and stats
    let processedCount = 0;
    jsonFiles.forEach(file => {
      const filePath = path.join(chatsPath, file);
      
      // Get file stats for modification time
      fs.stat(filePath, (statErr, stats) => {
        if (statErr) {
          console.error(`Failed to get stats for ${file}:`, statErr);
          return;
        }
        
        // Read file content for title
        fs.readFile(filePath, 'utf-8', (readErr, data) => {
          if (readErr) {
            console.error(`Failed to read ${file}:`, readErr);
            chatList.push({
              filename: file,
              displayName: file.replace('.json', ''),
              path: filePath,
              mtime: stats.mtime
            });
          } else {
            try {
              const jsonData = JSON.parse(data);
              chatList.push({
                filename: file,
                displayName: jsonData.title || file.replace('.json', ''),
                path: filePath,
                mtime: stats.mtime
              });
            } catch (e) {
              console.error(`Failed to parse ${file}:`, e);
              chatList.push({
                filename: file,
                displayName: file.replace('.json', ''),
                path: filePath,
                mtime: stats.mtime
              });
            }
          }
          
          processedCount++;
          if (processedCount === jsonFiles.length) {
            // Sort by modification time, newest first
            chatList.sort((a, b) => b.mtime - a.mtime);
            mainWindow.webContents.send('chat-list', chatList);
          }
        });
      });
    });
  });
}

// Handle loading a chat from the sidebar
ipcMain.handle('load-chat', async (event, filePath) => {
  loadChatFile(filePath);
  return { success: true };
});

// Handle deleting a chat
ipcMain.handle('delete-chat', async (event, filePath) => {
  try {
    // Check if the file exists
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File does not exist' };
    }

    // Delete the file
    fs.unlinkSync(filePath);
    
    // If this was the currently loaded chat, clear the main window
    if (currentWatcher && currentWatcher.path === filePath) {
      mainWindow.webContents.send('load-json', {
        data: JSON.stringify({ messages: [] }),
        filePath: null,
        filename: ''
      });
      currentWatcher = null;
    }

    // Update the chat list
    sendChatList();
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting chat:', error);
    return { success: false, error: error.message };
  }
});

// Handle saving updated JSON files
ipcMain.handle('save-json', async (event, { filePath, jsonData }) => {
  try {
    // Check if we're trying to save to default.json
    const isDefault = path.basename(filePath) === 'default.json';
    
    if (isDefault) {
      // Create a new file with timestamp
      const timestamp = new Date().toISOString()
        .replace(/[:.]/g, '-')  // Replace colons and periods with hyphens
        .replace('T', '_')      // Replace T with underscore
        .replace('Z', '');      // Remove Z
      const newFilePath = path.join(__dirname, '../../chats', `chat_${timestamp}.json`);
      
      // Set the title to the timestamp
      jsonData.title = timestamp;
      
      await fs.promises.writeFile(newFilePath, JSON.stringify(jsonData, null, 2), 'utf-8');
      
      // Update the chat list
      sendChatList();
      
      // Load the new file
      loadChatFile(newFilePath);
      
      return { success: true, newFilePath };
    } else {
      // Normal save for non-default files
      await fs.promises.writeFile(filePath, JSON.stringify(jsonData, null, 2), 'utf-8');
      
      // Update the chat list
      sendChatList();
      
      return { success: true };
    }
  } catch (error) {
    console.error('Failed to save file:', error);
    return { success: false, error: error.message };
  }
});

// Helper function for saving JSON data during streaming (lighter version)
async function saveJsonDataForStreaming(filePath, jsonData) {
  try {
    // Check if we're trying to save to default.json
    const isDefault = path.basename(filePath) === 'default.json';
    
    if (isDefault) {
      // Create a new file with timestamp
      const timestamp = new Date().toISOString()
        .replace(/[:.]/g, '-')  // Replace colons and periods with hyphens
        .replace('T', '_')      // Replace T with underscore
        .replace('Z', '');      // Remove Z
      const newFilePath = path.join(__dirname, '../../chats', `chat_${timestamp}.json`);
      
      // Set the title to the timestamp
      jsonData.title = timestamp;
      
      await fs.promises.writeFile(newFilePath, JSON.stringify(jsonData, null, 2), 'utf-8');
      
      return { success: true, newFilePath };
    } else {
      // Normal save for non-default files (just write, don't trigger UI updates)
      await fs.promises.writeFile(filePath, JSON.stringify(jsonData, null, 2), 'utf-8');
      
      return { success: true };
    }
  } catch (error) {
    console.error('Failed to save file during streaming:', error);
    return { success: false, error: error.message };
  }
}

// Helper function for saving JSON data (full version with UI updates)
async function saveJsonData(filePath, jsonData) {
  try {
    // Check if we're trying to save to default.json
    const isDefault = path.basename(filePath) === 'default.json';
    
    if (isDefault) {
      // Create a new file with timestamp
      const timestamp = new Date().toISOString()
        .replace(/[:.]/g, '-')  // Replace colons and periods with hyphens
        .replace('T', '_')      // Replace T with underscore
        .replace('Z', '');      // Remove Z
      const newFilePath = path.join(__dirname, '../../chats', `chat_${timestamp}.json`);
      
      // Set the title to the timestamp
      jsonData.title = timestamp;
      
      await fs.promises.writeFile(newFilePath, JSON.stringify(jsonData, null, 2), 'utf-8');
      
      // Update the chat list
      sendChatList();
      
      // Load the new file
      loadChatFile(newFilePath);
      
      return { success: true, newFilePath };
    } else {
      // Normal save for non-default files
      await fs.promises.writeFile(filePath, JSON.stringify(jsonData, null, 2), 'utf-8');
      
      // Update the chat list
      sendChatList();
      
      return { success: true };
    }
  } catch (error) {
    console.error('Failed to save file:', error);
    return { success: false, error: error.message };
  }
}

// Handle OpenAI API calls
ipcMain.handle('call-openai', async (event, filePath) => {
  try {
    console.log('Starting OpenAI streaming request...');
    
    // Read the current file
    const data = await fs.promises.readFile(filePath, 'utf-8');
    const chatData = JSON.parse(data);
    
    // Prepare messages for OpenAI (filter out tool responses for now)
    const messages = chatData.messages.filter(msg => 
      msg.role === 'system' || 
      msg.role === 'user' || 
      (msg.role === 'assistant' && !msg.tool_calls)
    ).map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Create the assistant message object that we'll be streaming into
    const assistantMessage = {
      role: 'assistant',
      content: ''
    };
    
    // Add the assistant message to the chat data
    chatData.messages.push(assistantMessage);
    const messageIndex = chatData.messages.length - 1;
    
    console.log(`Created empty assistant message at index ${messageIndex}`);
    
    // Immediately trigger UI update to show the new empty message
    mainWindow.webContents.send('streaming-update', {
      messageIndex,
      content: '',
      isComplete: false
    });

    console.log('Sent initial streaming update to UI');

    // Create the streaming request
    const stream = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: messages,
      stream: true,
      temperature: 0.7,
        tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Gets the weather for a location',
            parameters: {
              type: 'object',
              properties: {
                location: {
                  type: 'string',
                  description: 'City and country to get the weather for'
                }
              },
              required: ['location']
            }
          }
        }
      ],
      tool_choice: 'auto'
    });

    console.log('OpenAI stream created, starting to process tokens...');

    let fullContent = '';
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL = 3000; // Increased to 3 seconds to reduce I/O
    let tokenCount = 0;
    const toolCallData = [];
    
    // Process the stream
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      const toolCalls = chunk.choices[0]?.delta?.tool_calls || '';
      
      if (content) {
        tokenCount++;
        fullContent += content;
        assistantMessage.content = fullContent;
        
        // Log first few tokens for debugging
        if (tokenCount <= 5) {
          console.log(`Token ${tokenCount}: "${content}"`);
        }
        
        // Send real-time update to UI immediately
        mainWindow.webContents.send('streaming-update', {
          messageIndex,
          content: fullContent,
          isComplete: false
        });
        
        // Periodic save (every 3 seconds) - use lighter save function
        const now = Date.now();
        if (now - lastSaveTime > SAVE_INTERVAL) {
          try {
            const result = await saveJsonDataForStreaming(filePath, chatData);
            if (result.newFilePath) {
              filePath = result.newFilePath; // Update path if it changed
            }
            lastSaveTime = now;
            console.log('Periodic save completed during streaming');
          } catch (saveError) {
            console.error('Error during periodic save:', saveError);
          }
        }
      }

      if (toolCalls) {
        for (const chunk of toolCalls) {
          const item = toolCallData[chunk.index];
          if (item) {
            // Does this need to be generalized?
            toolCallData[chunk.index].function.arguments += chunk.function.arguments;
          } else {
            toolCallData[chunk.index] = chunk;
          }
        }
      }
    }
    
    console.log(`Streaming completed. Total tokens: ${tokenCount}, Final content length: ${fullContent.length}`);
    if (toolCallData.length) {
      for (const toolCall of toolCallData) {
        const result = handleToolCall(toolCall);
        const message = {
            "type": "function_call_output",
            "call_id": toolCall.id,
            "output": result.toString()
        }
        // TODO: Pass this back to the AI and keep going.
      }
    }
    
    // Final save and completion signal - use full save function for final save
    const result = await saveJsonData(filePath, chatData);
    mainWindow.webContents.send('streaming-update', {
      messageIndex,
      content: fullContent,
      isComplete: true
    });
    
    console.log('Final save completed and completion signal sent');
    
    return { 
      success: true, 
      newFilePath: result.newFilePath || filePath 
    };
    
  } catch (error) {
    console.error('OpenAI API error:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
});

// Function to load default chat on startup
function loadDefaultChat() {
  const configDir = path.join(__dirname, '../../config');
  const defaultPath = path.join(configDir, 'default.json');
  
  // Ensure config directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  // Check if default.json exists
  if (!fs.existsSync(defaultPath)) {
    // Create default template
    const defaultTemplate = {
      title: "New Chat",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant."
        }
      ]
    };
    
    // Write default template
    fs.writeFileSync(defaultPath, JSON.stringify(defaultTemplate, null, 2));
    console.log('Created default chat template');
  }
  
  // Load the default chat
  loadChatFile(defaultPath);
}

function handleToolCall(toolCall) {
  if (toolCall.type !== 'function') {
    throw 'Expected a function call.';
  }

  const name = toolCall.function.name;
  const args = toolCall.function.arguments;

  switch (name) {
    case 'get_weather':
      return 'Tornado watch!'
    default:
      console.error(`Unknown function '${name}'.`);
      break;
  }
}

app.whenReady()
  .then(createWindow)
  .catch(err => console.error('Failed to create window:', err));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
}); 