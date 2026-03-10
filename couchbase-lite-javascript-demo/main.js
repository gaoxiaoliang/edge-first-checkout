import { Database, Replicator } from '@couchbase/lite-js';

const APP_SERVICE_URL = 'wss://xxxxx.apps.cloud.couchbase.com/ica-checkout-app-service';
const USERNAME = 'xxx-user';
const PASSWORD = 'xxx';
const PAGE_SIZE = 10;

let database = null;
let replicator = null;
let currentPage = 1;
let totalCount = 0;

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const syncStatus = document.getElementById('syncStatus');
const tableContent = document.getElementById('tableContent');
const pagination = document.getElementById('pagination');
const pageInfo = document.getElementById('pageInfo');
const toast = document.getElementById('toast');

window.cblDebug = { database: null, replicator: null };

function showToast(message, type = 'info') {
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

function updateConnectionStatus(status, message) {
  statusText.textContent = message;
  statusDot.className = 'status-dot';
  if (status === 'connected') {
    statusDot.classList.add('connected');
  } else if (status === 'syncing') {
    statusDot.classList.add('syncing');
  }
}

function updateSyncStatus(status, progress) {
  if (progress) {
    syncStatus.textContent = `Sync: ${status} (${progress.completed}/${progress.total})`;
  } else {
    syncStatus.textContent = `Sync: ${status}`;
  }
}

function getCollection() {
  return database.collections['_default'];
}

async function initDatabase() {
  try {
    updateConnectionStatus('disconnected', 'Opening database...');
    
    database = await Database.open({
      name: 'ica-checkout-demo',
      version: 1,
      collections: {
        '_default': {}
      }
    });
    
    window.cblDebug.database = database;
    
    console.log('Database opened successfully');
    console.log('Available collections:', database.collectionNames);
    
    updateConnectionStatus('disconnected', 'Database ready, connecting to sync...');
    
    await initReplicator();
    
    await loadTransactions();
    
    setupEventListeners();
    
    getCollection().addChangeListener((changes) => {
      console.log('Collection changed:', changes);
      loadTransactions();
    });
    
  } catch (error) {
    console.error('Failed to initialize database:', error);
    updateConnectionStatus('disconnected', 'Error: ' + error.message);
    showToast('Failed to initialize: ' + error.message, 'error');
  }
}

async function initReplicator() {
  try {
    const replicatorConfig = {
      database: database,
      url: APP_SERVICE_URL,
      collections: {
        '_default': {
          pull: {},
          push: {}
        }
      },
      credentials: {
        username: USERNAME,
        password: PASSWORD
      },
      continuous: true
    };
    
    console.log('Creating replicator with URL:', APP_SERVICE_URL);
    
    replicator = new Replicator(replicatorConfig);
    window.cblDebug.replicator = replicator;
    
    replicator.onStatusChange = (status) => {
      console.log('Replication status:', JSON.stringify(status, null, 2));
      
      if (status.error) {
        console.error('Replication error:', status.error);
        updateConnectionStatus('disconnected', 'Error: ' + (status.error.message || String(status.error)));
        updateSyncStatus('Error');
        showToast('Sync error: ' + (status.error.message || String(status.error)), 'error');
        return;
      }
      
      const activity = status.activity || status.status;
      
      switch (activity) {
        case 'connecting':
        case 'CONNECTING':
          updateConnectionStatus('disconnected', 'Connecting...');
          updateSyncStatus('Connecting');
          break;
        case 'busy':
        case 'BUSY':
          updateConnectionStatus('syncing', 'Syncing...');
          updateSyncStatus('Busy', status.progress);
          break;
        case 'idle':
        case 'IDLE':
          updateConnectionStatus('connected', 'Connected');
          updateSyncStatus('Idle');
          loadTransactions();
          break;
        case 'stopped':
        case 'STOPPED':
          updateConnectionStatus('disconnected', 'Disconnected');
          updateSyncStatus('Stopped');
          break;
        case 'offline':
        case 'OFFLINE':
          updateConnectionStatus('disconnected', 'Offline');
          updateSyncStatus('Offline');
          break;
        default:
          console.log('Unknown activity:', activity);
          updateConnectionStatus('disconnected', activity || 'Unknown');
          updateSyncStatus(activity || 'Unknown');
      }
    };
    
    replicator.onDocuments = (collection, direction, documents) => {
      console.log(`Documents ${direction}:`, documents.length);
    };
    
    console.log('Starting replicator...');
    await replicator.run();
    console.log('Replicator started');
    
  } catch (error) {
    console.error('Failed to initialize replicator:', error);
    updateConnectionStatus('disconnected', 'Sync Error');
    showToast('Failed to connect: ' + error.message, 'error');
  }
}

async function addTransaction() {
  const transactionId = document.getElementById('newTransactionId').value.trim();
  const totalAmount = parseFloat(document.getElementById('newTotalAmount').value);
  const description = document.getElementById('newDescription').value.trim();
  
  if (isNaN(totalAmount) || totalAmount < 0) {
    showToast('Please enter a valid total amount', 'error');
    return;
  }
  
  try {
    const collection = getCollection();
    
    const docData = {
      type: 'transaction',
      transaction_id: transactionId || `txn_${Date.now()}`,
      total_amount: totalAmount,
      description: description || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    console.log('Adding document:', docData);
    
    const doc = collection.createDocument(null, docData);
    await collection.save(doc);
    
    document.getElementById('newTransactionId').value = '';
    document.getElementById('newTotalAmount').value = '';
    document.getElementById('newDescription').value = '';
    
    showToast('Transaction added successfully!', 'success');
    
  } catch (error) {
    console.error('Failed to add transaction:', error);
    showToast('Failed to add transaction: ' + error.message, 'error');
  }
}

async function deleteTransaction() {
  const transactionId = document.getElementById('deleteTransactionId').value.trim();
  
  if (!transactionId) {
    showToast('Please enter a transaction ID', 'error');
    return;
  }
  
  try {
    const collection = getCollection();
    
    const query = database.createQuery(`
      SELECT META().id AS docId
      FROM \`_default\`
      WHERE transaction_id = $transactionId AND type = 'transaction'
    `);
    query.parameters = { transactionId };
    
    const results = await query.execute();
    
    if (results.length === 0) {
      showToast('Transaction not found', 'error');
      return;
    }
    
    const docId = results[0].docId;
    const doc = await collection.getDocument(docId);
    
    if (doc) {
      await collection.delete(doc);
      document.getElementById('deleteTransactionId').value = '';
      showToast('Transaction deleted successfully!', 'success');
    }
    
  } catch (error) {
    console.error('Failed to delete transaction:', error);
    showToast('Failed to delete transaction: ' + error.message, 'error');
  }
}

async function updateTransaction() {
  const transactionId = document.getElementById('updateTransactionId').value.trim();
  const newTotalAmount = parseFloat(document.getElementById('updateTotalAmount').value);
  
  if (!transactionId) {
    showToast('Please enter a transaction ID', 'error');
    return;
  }
  
  if (isNaN(newTotalAmount) || newTotalAmount < 0) {
    showToast('Please enter a valid total amount', 'error');
    return;
  }
  
  try {
    const collection = getCollection();
    
    const query = database.createQuery(`
      SELECT META().id AS docId
      FROM \`_default\`
      WHERE transaction_id = $transactionId AND type = 'transaction'
    `);
    query.parameters = { transactionId };
    
    const results = await query.execute();
    
    if (results.length === 0) {
      showToast('Transaction not found', 'error');
      return;
    }
    
    const docId = results[0].docId;
    const doc = await collection.getDocument(docId);
    
    if (doc) {
      doc.total_amount = newTotalAmount;
      doc.updated_at = new Date().toISOString();
      await collection.save(doc);
      
      document.getElementById('updateTransactionId').value = '';
      document.getElementById('updateTotalAmount').value = '';
      showToast('Transaction updated successfully!', 'success');
    }
    
  } catch (error) {
    console.error('Failed to update transaction:', error);
    showToast('Failed to update transaction: ' + error.message, 'error');
  }
}

async function loadTransactions() {
  try {
    console.log('Loading transactions...');
    
    const countQuery = database.createQuery(`
      SELECT COUNT(*) AS total
      FROM \`_default\`
      WHERE type = 'transaction'
    `);
    const countResults = await countQuery.execute();
    totalCount = countResults[0]?.total || 0;
    console.log('Total transactions:', totalCount);
    
    const offset = (currentPage - 1) * PAGE_SIZE;
    
    const query = database.createQuery(`
      SELECT META().id AS docId, transaction_id, total_amount, description, created_at, updated_at
      FROM \`_default\`
      WHERE type = 'transaction'
      ORDER BY created_at DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `);
    
    const results = await query.execute();
    console.log('Query results:', results);
    
    renderTable(results);
    renderPagination();
    
  } catch (error) {
    console.error('Failed to load transactions:', error);
    tableContent.innerHTML = `<div class="empty-state">Error loading data: ${error.message}</div>`;
  }
}

function renderTable(results) {
  if (!results || results.length === 0) {
    tableContent.innerHTML = '<div class="empty-state">No transactions found. Add your first transaction above or wait for sync to complete.</div>';
    return;
  }
  
  let html = `
    <table>
      <thead>
        <tr>
          <th>Transaction ID</th>
          <th>Total Amount</th>
          <th>Description</th>
          <th>Created At</th>
          <th>Updated At</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  for (const row of results) {
    html += `
      <tr>
        <td>${row.transaction_id || '-'}</td>
        <td>${row.total_amount != null ? row.total_amount.toFixed(2) : '0.00'}</td>
        <td>${row.description || '-'}</td>
        <td>${row.created_at ? new Date(row.created_at).toLocaleString() : '-'}</td>
        <td>${row.updated_at ? new Date(row.updated_at).toLocaleString() : '-'}</td>
      </tr>
    `;
  }
  
  html += '</tbody></table>';
  tableContent.innerHTML = html;
}

function renderPagination() {
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  
  if (totalPages <= 1) {
    pagination.style.display = 'none';
    return;
  }
  
  pagination.style.display = 'flex';
  pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${totalCount} total)`;
  
  document.getElementById('prevBtn').disabled = currentPage <= 1;
  document.getElementById('nextBtn').disabled = currentPage >= totalPages;
}

function setupEventListeners() {
  document.getElementById('addBtn').addEventListener('click', addTransaction);
  document.getElementById('deleteBtn').addEventListener('click', deleteTransaction);
  document.getElementById('updateBtn').addEventListener('click', updateTransaction);
  
  document.getElementById('prevBtn').addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadTransactions();
    }
  });
  
  document.getElementById('nextBtn').addEventListener('click', () => {
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    if (currentPage < totalPages) {
      currentPage++;
      loadTransactions();
    }
  });
  
  document.getElementById('newTotalAmount').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTransaction();
  });
  
  document.getElementById('deleteTransactionId').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') deleteTransaction();
  });
  
  document.getElementById('updateTotalAmount').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') updateTransaction();
  });
}

initDatabase();
