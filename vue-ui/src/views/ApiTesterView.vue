<template>
  <MCard flex autoHeight direction="row" gap="0.5" padding="" outlined elevated :style="{ height: '90vh' }">
    <!-- ═══ SIDEBAR ═══ -->
    <ExpandableSidebar expandedWidth="240px" :defaultExpanded="true">
      <template #collapsed>
        <button class="p-2 rounded bg-slate-600 hover:opacity-100 hover:bg-slate-500 transition-opacity duration-150 text-[var(--p-slate-50)]" title="Saved Requests">
          <i class="pi pi-bookmark text-sm"></i>
        </button>
      </template>
      <template #default>
        <!-- ── Endpoints section ────────────────────────────────────── -->
        <div class="sidebar-section endpoints-section">
          <div class="sidebar-section-header">
            <h4>Endpoints</h4>
            <button
              class="sidebar-icon-btn"
              title="Refresh RESTlets & Suitelets"
              :disabled="loadingScripts"
              @click="loadScripts"
            >
              <i :class="loadingScripts ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'" class="text-xs"></i>
            </button>
          </div>

          <!-- Search box — shown once loaded and list is non-empty -->
          <div v-if="scriptsLoaded && endpointScripts.length > 0" class="endpoints-search">
            <i class="pi pi-search endpoints-search-icon"></i>
            <input
              v-model="scriptSearch"
              class="endpoints-search-input"
              placeholder="Search endpoints…"
              type="text"
              autocomplete="off"
            />
            <button
              v-if="scriptSearch"
              class="endpoints-search-clear"
              title="Clear"
              @click="scriptSearch = ''"
            >
              <i class="pi pi-times text-xs"></i>
            </button>
          </div>

          <!-- Loading -->
          <div v-if="loadingScripts" class="endpoints-loading">
            <i class="pi pi-spin pi-spinner text-indigo-400 text-sm"></i>
            <span>Loading scripts…</span>
          </div>

          <!-- Loaded: no results from API -->
          <div v-else-if="scriptsLoaded && endpointScripts.length === 0" class="endpoints-empty">
            No RESTlets or Suitelets found.
          </div>

          <!-- Loaded: no results from search filter -->
          <div v-else-if="scriptsLoaded && filteredRestlets.length === 0 && filteredSuitelets.length === 0 && scriptSearch" class="endpoints-empty">
            No matches for "{{ scriptSearch }}"
          </div>

          <!-- Loaded: script list -->
          <div v-else-if="scriptsLoaded" class="endpoints-list">
            <!-- RESTlets group -->
            <template v-if="filteredRestlets.length > 0">
              <div class="endpoint-group-label">RESTlets</div>
              <div
                v-for="script in filteredRestlets"
                :key="script.id"
                class="endpoint-script"
              >
                <button
                  class="endpoint-script-btn"
                  :class="{ 'is-expanded': expandedScriptIds.has(script.id) }"
                  @click="toggleScriptExpand(script)"
                >
                  <i :class="expandedScriptIds.has(script.id) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" class="endpoint-chevron"></i>
                  <span class="endpoint-name" :title="script.name">{{ script.name }}</span>
                  <i v-if="loadingDeploymentFor === script.id" class="pi pi-spin pi-spinner text-xs text-indigo-400 ml-auto"></i>
                </button>
                <div v-if="expandedScriptIds.has(script.id)" class="deployment-list">
                  <div v-if="script.deployments.length === 0 && !loadingDeploymentFor" class="deployment-empty">
                    No deployments
                  </div>
                  <button
                    v-for="dep in script.deployments"
                    :key="dep.primarykey"
                    class="deployment-item"
                    :title="`${dep.scriptid} — ${dep.isdeployed ? 'Deployed' : 'Not deployed'}`"
                    @click="useDeployment(script, dep)"
                  >
                    <i class="pi pi-send text-xs text-indigo-500 flex-shrink-0"></i>
                    <span class="deployment-id">{{ dep.scriptid }}</span>
                    <span v-if="!dep.isdeployed" class="deployment-inactive" title="Not deployed">off</span>
                  </button>
                </div>
              </div>
            </template>

            <!-- Suitelets group -->
            <template v-if="filteredSuitelets.length > 0">
              <div class="endpoint-group-label" :class="{ 'mt-2': filteredRestlets.length > 0 }">Suitelets</div>
              <div
                v-for="script in filteredSuitelets"
                :key="script.id"
                class="endpoint-script"
              >
                <button
                  class="endpoint-script-btn"
                  :class="{ 'is-expanded': expandedScriptIds.has(script.id) }"
                  @click="toggleScriptExpand(script)"
                >
                  <i :class="expandedScriptIds.has(script.id) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" class="endpoint-chevron"></i>
                  <span class="endpoint-name" :title="script.name">{{ script.name }}</span>
                  <i v-if="loadingDeploymentFor === script.id" class="pi pi-spin pi-spinner text-xs text-indigo-400 ml-auto"></i>
                </button>
                <div v-if="expandedScriptIds.has(script.id)" class="deployment-list">
                  <div v-if="script.deployments.length === 0 && !loadingDeploymentFor" class="deployment-empty">
                    No deployments
                  </div>
                  <button
                    v-for="dep in script.deployments"
                    :key="dep.primarykey"
                    class="deployment-item"
                    :title="`${dep.scriptid} — ${dep.isdeployed ? 'Deployed' : 'Not deployed'}`"
                    @click="useDeployment(script, dep)"
                  >
                    <i class="pi pi-send text-xs text-purple-500 flex-shrink-0"></i>
                    <span class="deployment-id">{{ dep.scriptid }}</span>
                    <span v-if="!dep.isdeployed" class="deployment-inactive" title="Not deployed">off</span>
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>

        <div class="sidebar-divider"></div>

        <!-- ── Saved Requests section ──────────────────────────────── -->
        <div class="sidebar-section sidebar-section-files">
          <div class="sidebar-section-header">
            <h4>Saved Requests</h4>
          </div>
          <div class="endpoints-search">
            <i class="pi pi-search endpoints-search-icon"></i>
            <input
              v-model="requestSearch"
              class="endpoints-search-input"
              placeholder="Search requests…"
              type="text"
              autocomplete="off"
            />
            <button v-if="requestSearch" class="endpoints-search-clear" @click="requestSearch = ''">
              <i class="pi pi-times text-xs"></i>
            </button>
          </div>
          <div class="flex flex-col gap-1 overflow-y-auto pr-1 flex-1 min-h-0">
            <div
              v-for="req in filteredRequests"
              :key="req.id"
              class="saved-req-item group"
              :class="{ 'saved-req-item--active': activeRequestId === req.id }"
              @click="openRequestInTab(req.id)"
            >
              <span class="req-method-badge" :class="methodClass(req.method)">{{ req.method }}</span>
              <MInput
                v-model="req.name"
                outlined
                item-dynamic
                class="flex-1 min-w-0"
              />
              <button
                class="ml-auto p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-300 flex-shrink-0"
                title="Delete request"
                @click.stop="removeRequest(req.id)"
              >
                <i class="pi pi-times text-xs"></i>
              </button>
            </div>
            <div v-if="requests.length === 0" class="text-gray-400 text-xs text-center mt-2 px-2">
              No saved requests
            </div>
          </div>
          <Button size="small" text class="mt-2 w-full" @click="addNewRequest">
            <i class="pi pi-plus text-sm mr-1"></i>
            New Request
          </Button>
        </div>

        <div class="sidebar-divider"></div>

        <!-- ── History section ──────────────────────────────────────── -->
        <div class="sidebar-section history-section">
          <div class="sidebar-section-header">
            <h4>History</h4>
            <button v-if="history.length > 0" class="sidebar-icon-btn" title="Clear history" @click="clearHistory">
              <i class="pi pi-trash text-xs"></i>
            </button>
          </div>
          <div class="history-list">
            <div
              v-for="entry in history"
              :key="entry.id"
              class="history-item"
              :class="{ 'is-active': selectedHistoryEntry?.id === entry.id }"
              :title="`${entry.method} ${entry.url}`"
              @click="viewHistoryEntry(entry)"
            >
              <span class="method-badge" :class="methodClass(entry.method)">{{ entry.method }}</span>
              <span class="history-url">{{ entry.url }}</span>
              <span v-if="entry.status" class="history-status" :class="statusClass(entry.status)">{{ entry.status }}</span>
              <button
                class="history-delete-btn"
                title="Delete this entry"
                @click.stop="deleteHistoryEntry(entry)"
              >
                <i class="pi pi-times text-xs"></i>
              </button>
            </div>
            <div v-if="history.length === 0" class="text-gray-400 text-xs text-center mt-2 px-2">
              No history yet
            </div>
          </div>
        </div>
      </template>
    </ExpandableSidebar>

    <!-- ═══ MAIN AREA ═══ -->
    <div class="api-main" ref="mainRef">

      <!-- ── SPLIT LEFT: request tabs / history viewer ── -->
      <div class="split-left" :style="{ width: splitLeftWidth + 'px' }">

        <!-- ── History Viewer (replaces tabs when a history entry is selected) ── -->
        <template v-if="selectedHistoryEntry">
          <div class="history-viewer">
            <!-- Header bar -->
            <div class="history-viewer-header">
              <span class="method-badge" :class="methodClass(selectedHistoryEntry.method)">{{ selectedHistoryEntry.method }}</span>
              <span class="history-viewer-url" :title="selectedHistoryEntry.url">{{ selectedHistoryEntry.url }}</span>
              <span class="history-viewer-time">{{ formatHistoryTime(selectedHistoryEntry.timestamp) }}</span>
              <div class="history-viewer-actions">
                <button
                  class="editor-action-btn"
                  title="Load this request into the current tab"
                  @click="reuseHistoryEntry(selectedHistoryEntry)"
                >
                  <i class="pi pi-arrow-up-right text-xs"></i>
                  Reuse
                </button>
                <button
                  class="editor-action-btn"
                  title="Close history viewer"
                  @click="selectedHistoryEntry = null"
                >
                  <i class="pi pi-times text-xs"></i>
                </button>
              </div>
            </div>

            <!-- Response panel -->
            <div v-if="selectedHistoryEntry.response" class="response-body">
              <div class="response-meta">
                <span class="status-badge" :class="statusClass(selectedHistoryEntry.response.status)">
                  {{ selectedHistoryEntry.response.status }} {{ selectedHistoryEntry.response.statusText }}
                </span>
                <span class="response-duration">{{ selectedHistoryEntry.response.duration }}ms</span>
                <span v-if="selectedHistoryEntry.response.error" class="text-red-500 text-xs ml-2">{{ selectedHistoryEntry.response.error }}</span>
              </div>

              <div class="tab-bar mt-1">
                <button
                  v-for="tab in historyViewerResponseTabs"
                  :key="tab"
                  :class="['tab-btn', { active: historyViewerTab === tab }]"
                  @click="onHistoryViewerTabClick(tab)"
                >
                  <i v-if="tab === 'Preview'" class="pi pi-eye text-xs mr-1"></i>
                  <i v-if="tab === 'Logs'" class="pi pi-list text-xs mr-1"></i>
                  {{ tab }}
                  <span v-if="tab === 'Logs' && selectedHistoryEntry.logsLoading" class="ml-1">
                    <i class="pi pi-spin pi-spinner text-xs"></i>
                  </span>
                  <span v-else-if="tab === 'Logs' && selectedHistoryEntry.logs && selectedHistoryEntry.logs.length > 0" class="tab-badge">
                    {{ selectedHistoryEntry.logs.length }}
                  </span>
                </button>
                <div v-if="historyViewerTab === 'Body'" class="ml-auto flex gap-1">
                  <button class="fmt-btn" :class="{ active: historyViewerFormat === 'pretty' }" @click="historyViewerFormat = 'pretty'">Pretty</button>
                  <button class="fmt-btn" :class="{ active: historyViewerFormat === 'raw' }" @click="historyViewerFormat = 'raw'">Raw</button>
                  <button class="fmt-btn ml-1" @click="copyHistoryBody()" title="Copy response">
                    <i class="pi pi-copy text-xs"></i>
                  </button>
                </div>
                <div v-else-if="historyViewerTab === 'Headers'" class="ml-auto flex gap-1">
                  <button class="fmt-btn ml-1" @click="copyHistoryHeaders()" title="Copy headers">
                    <i class="pi pi-copy text-xs"></i>
                  </button>
                </div>
              </div>

              <!-- Body -->
              <div v-if="historyViewerTab === 'Body'" class="response-content">
                <pre class="response-pre">{{ formattedHistoryBody }}</pre>
              </div>

              <!-- Headers -->
              <div v-else-if="historyViewerTab === 'Headers'" class="response-content">
                <div v-for="(value, key) in selectedHistoryEntry.response.headers" :key="key" class="header-row">
                  <span class="header-key">{{ key }}</span>
                  <span class="header-value">{{ value }}</span>
                </div>
                <div v-if="Object.keys(selectedHistoryEntry.response.headers).length === 0" class="text-gray-400 text-xs text-center mt-4">
                  No response headers
                </div>
              </div>

              <!-- Preview -->
              <div v-else-if="historyViewerTab === 'Preview'" class="response-content preview-content">
                <div v-if="historyViewerPreviewLoading" class="response-empty">
                  <i class="pi pi-spin pi-spinner text-2xl text-indigo-400 mb-2"></i>
                  <p class="text-gray-400 text-sm">Fetching styles…</p>
                </div>
                <iframe
                  v-else
                  class="preview-iframe"
                  :srcdoc="historyViewerPreviewSrc ?? ''"
                  sandbox="allow-scripts allow-forms allow-same-origin"
                ></iframe>
              </div>

              <!-- Logs -->
              <div v-else-if="historyViewerTab === 'Logs'" class="response-content">
                <div v-if="selectedHistoryEntry.logsLoading" class="response-empty">
                  <i class="pi pi-spin pi-spinner text-2xl text-indigo-400 mb-2"></i>
                  <p class="text-gray-400 text-sm">Fetching logs…</p>
                </div>
                <div v-else-if="!selectedHistoryEntry.logs || selectedHistoryEntry.logs.length === 0" class="response-empty">
                  <i class="pi pi-list text-3xl text-gray-300 mb-2"></i>
                  <p class="text-gray-400 text-sm">No logs found for this request.</p>
                </div>
                <div v-else class="logs-list">
                  <div v-for="log in selectedHistoryEntry.logs" :key="log.id" class="log-entry">
                    <span class="log-level-badge" :class="logLevelClass(log.level)">{{ log.level }}</span>
                    <span class="log-datetime">{{ formatLogDatetime(log.datetime) }}</span>
                    <div class="log-body">
                      <span v-if="log.title" class="log-title">{{ log.title }}</span>
                      <span class="log-message">{{ log.message }}</span>
                    </div>
                    <span v-if="log.scriptName" class="log-script">{{ log.scriptName }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- No response data (shouldn't happen, but guard) -->
            <div v-else class="response-empty">
              <i class="pi pi-exclamation-circle text-3xl text-gray-300 mb-2"></i>
              <p class="text-gray-400 text-sm">No response data available.</p>
            </div>
          </div>
        </template>

        <!-- ── Normal request tabs ── -->
        <template v-else>
        <!-- Tabs for open requests -->
        <MTabs
        v-if="openTabs.length > 0"
        :tabs="tabs"
        :dynamic="true"
        v-model="activeRequestId"
        @add-tab="addNewRequest"
        @delete-tab="removeRequestByTab"
      >
        <template #tab-content="{ activeTab: activeTabName, contentHeight }">
          <div
            v-for="req in requests"
            :key="req.id"
            v-show="activeTabName === req.id"
            class="request-panel"
            :style="{ height: contentHeight + 'px' }"
          >
            <!-- URL bar -->
            <div class="url-bar">
              <MSelect
                v-model="req.method"
                :options="methodsForRequest(req)"
                size="small"
                class="method-select"
              />
              <InputText
                :model-value="buildUrl(req)"
                placeholder="https://your-account.app.netsuite.com/..."
                size="small"
                class="url-input"
                @update:model-value="(v) => onUrlBarInput(req, String(v))"
                @keydown.enter="sendRequest(req.id)"
              />
              <Button size="small" @click="sendRequest(req.id)" :loading="req.isLoading" :disabled="!req.url.trim()">
                <i class="pi pi-send text-xs mr-1"></i> Send
              </Button>
            </div>

            <!-- Request config tabs -->
            <div class="request-section">
              <div class="tab-bar">
                <button
                  v-for="tab in REQUEST_TABS"
                  :key="tab"
                  :class="['tab-btn', { active: req.activeRequestTab === tab }]"
                  @click="req.activeRequestTab = tab"
                >
                  {{ tab }}
                  <span v-if="tab === 'Params' && activeParamsOf(req).length > 0" class="tab-badge">{{ activeParamsOf(req).length }}</span>
                  <span v-if="tab === 'Headers' && activeHeadersOf(req).length > 0" class="tab-badge">{{ activeHeadersOf(req).length }}</span>
                </button>
              </div>

              <!-- Params -->
              <div v-if="req.activeRequestTab === 'Params'" class="kv-editor">
                <!-- Warning when using a body method -->
                <div v-if="isBodyMethod(req.method)" class="params-body-hint">
                  <i class="pi pi-info-circle text-xs"></i>
                  Query params are not sent for <strong>{{ req.method }}</strong> — use the <strong>Body</strong> tab.
                </div>
                <div class="kv-header-row">
                  <span>Key</span><span>Value</span><span></span>
                </div>
                <div v-for="(row, i) in req.params" :key="i" class="kv-row">
                  <InputText v-model="row.key" placeholder="key" size="small" class="kv-input" />
                  <InputText v-model="row.value" placeholder="value" size="small" class="kv-input" />
                  <button class="kv-remove" @click="req.params.splice(i, 1)" title="Remove">
                    <i class="pi pi-times text-xs"></i>
                  </button>
                </div>
                <Button text size="small" class="mt-1" @click="req.params.push({ key: '', value: '' })">
                  <i class="pi pi-plus text-xs mr-1"></i> Add
                </Button>
              </div>

              <!-- Headers -->
              <div v-if="req.activeRequestTab === 'Headers'" class="kv-editor">
                <div class="kv-header-row">
                  <span>Key</span><span>Value</span><span></span>
                </div>
                <div v-for="(row, i) in req.headers" :key="i" class="kv-row">
                  <InputText v-model="row.key" placeholder="key" size="small" class="kv-input" />
                  <InputText v-model="row.value" placeholder="value" size="small" class="kv-input" />
                  <button class="kv-remove" @click="req.headers.splice(i, 1)" title="Remove">
                    <i class="pi pi-times text-xs"></i>
                  </button>
                </div>
                <Button text size="small" class="mt-1" @click="req.headers.push({ key: '', value: '' })">
                  <i class="pi pi-plus text-xs mr-1"></i> Add
                </Button>
              </div>

              <!-- Body -->
              <div v-if="req.activeRequestTab === 'Body'" class="body-editor">
                <div class="body-type-bar">
                  <MSelect
                    v-model="req.bodyType"
                    :options="BODY_TYPES"
                    size="small"
                    class="body-type-select"
                  />
                </div>

                <!-- Key-value JSON editor -->
                <template v-if="req.bodyType === 'key-value (JSON)'">
                  <div class="kv-header-row kv-body-header">
                    <span>Key (dot.notation)</span><span>Value</span><span>Type</span><span></span>
                  </div>
                  <div v-for="(row, i) in req.bodyKv" :key="i" class="kv-row">
                    <InputText v-model="row.key" placeholder="key or parent.child" size="small" class="kv-input" />
                    <InputText v-model="row.value" placeholder="value" size="small" class="kv-input" />
                    <MSelect v-model="row.type" :options="KV_BODY_TYPES" size="small" class="kv-type-select" />
                    <button class="kv-remove" @click="req.bodyKv.splice(i, 1)" title="Remove">
                      <i class="pi pi-times text-xs"></i>
                    </button>
                  </div>
                  <Button text size="small" class="mt-1" @click="req.bodyKv.push({ key: '', value: '', type: 'string' })">
                    <i class="pi pi-plus text-xs mr-1"></i> Add
                  </Button>
                  <div v-if="req.bodyKv.some(r => r.key.trim())" class="kv-json-preview">
                    <div class="kv-json-preview-label">JSON Preview</div>
                    <pre class="kv-json-preview-body">{{ buildNestedJson(req.bodyKv) }}</pre>
                  </div>
                </template>

                <!-- Raw textarea (all non-KV body types) -->
                <textarea
                  v-else
                  v-model="req.body"
                  class="body-textarea"
                  placeholder="Request body..."
                  spellcheck="false"
                  :disabled="req.bodyType === 'none'"
                />
              </div>
            </div>

            <!-- Response panel -->
            <div class="response-section">
              <div v-if="!req.response && !req.isLoading" class="response-empty">
                <i class="pi pi-send text-3xl text-gray-300 mb-2"></i>
                <p class="text-gray-400 text-sm">Send a request to see the response.</p>
              </div>

              <div v-else-if="req.isLoading" class="response-empty">
                <i class="pi pi-spin pi-spinner text-2xl text-indigo-400 mb-2"></i>
                <p class="text-gray-400 text-sm">Sending request...</p>
              </div>

              <div v-else-if="req.response" class="response-body">
                <div class="response-meta">
                  <span class="status-badge" :class="statusClass(req.response.status)">
                    {{ req.response.status }} {{ req.response.statusText }}
                  </span>
                  <span class="response-duration">{{ req.response.duration }}ms</span>
                  <span v-if="req.response.error" class="text-red-500 text-xs ml-2">{{ req.response.error }}</span>
                </div>

                <div class="tab-bar mt-1">
                  <button
                    v-for="tab in responseTabsOf(req)"
                    :key="tab"
                    :class="['tab-btn', { active: req.activeResponseTab === tab }]"
                    @click="onResponseTabClick(req, tab)"
                  >
                    <i v-if="tab === 'Preview'" class="pi pi-eye text-xs mr-1"></i>
                    <i v-if="tab === 'Logs'" class="pi pi-list text-xs mr-1"></i>
                    {{ tab }}
                    <span v-if="tab === 'Logs' && req.isLoadingLogs" class="ml-1">
                      <i class="pi pi-spin pi-spinner text-xs"></i>
                    </span>
                    <span v-else-if="tab === 'Logs' && req.logs && req.logs.length > 0" class="tab-badge">{{ req.logs.length }}</span>
                  </button>
                  <!-- Pretty / Raw / Copy — only for Body tab -->
                  <div v-if="req.activeResponseTab === 'Body'" class="ml-auto flex gap-1">
                    <button class="fmt-btn" :class="{ active: req.responseFormat === 'pretty' }" @click="req.responseFormat = 'pretty'">Pretty</button>
                    <button class="fmt-btn" :class="{ active: req.responseFormat === 'raw' }" @click="req.responseFormat = 'raw'">Raw</button>
                    <button class="fmt-btn ml-1" @click="copyResponse(req)" title="Copy response">
                      <i class="pi pi-copy text-xs"></i>
                    </button>
                  </div>
                  <div v-else-if="req.activeResponseTab === 'Headers'" class="ml-auto flex gap-1">
                    <button class="fmt-btn ml-1" @click="copyResponse(req)" title="Copy response">
                      <i class="pi pi-copy text-xs"></i>
                    </button>
                  </div>
                </div>

                <!-- Response Body -->
                <div v-if="req.activeResponseTab === 'Body'" class="response-content">
                  <pre class="response-pre">{{ formattedResponseBodyOf(req) }}</pre>
                </div>

                <!-- Response Headers -->
                <div v-else-if="req.activeResponseTab === 'Headers'" class="response-content">
                  <div v-for="(value, key) in req.response.headers" :key="key" class="header-row">
                    <span class="header-key">{{ key }}</span>
                    <span class="header-value">{{ value }}</span>
                  </div>
                  <div v-if="Object.keys(req.response.headers).length === 0" class="text-gray-400 text-xs text-center mt-4">
                    No response headers
                  </div>
                </div>

                <!-- HTML Preview — fetches and inlines CSS via proxy -->
                <div v-else-if="req.activeResponseTab === 'Preview'" class="response-content preview-content">
                  <div v-if="req.previewLoading" class="response-empty">
                    <i class="pi pi-spin pi-spinner text-2xl text-indigo-400 mb-2"></i>
                    <p class="text-gray-400 text-sm">Fetching styles…</p>
                  </div>
                  <iframe
                    v-else
                    class="preview-iframe"
                    :srcdoc="req.previewSrc ?? ''"
                    sandbox="allow-scripts allow-forms allow-same-origin"
                  ></iframe>
                </div>

                <!-- Logs tab -->
                <div v-else-if="req.activeResponseTab === 'Logs'" class="response-content">
                  <div v-if="req.isLoadingLogs" class="response-empty">
                    <i class="pi pi-spin pi-spinner text-2xl text-indigo-400 mb-2"></i>
                    <p class="text-gray-400 text-sm">Fetching logs…</p>
                  </div>
                  <div v-else-if="!req.logs || req.logs.length === 0" class="response-empty">
                    <i class="pi pi-list text-3xl text-gray-300 mb-2"></i>
                    <p class="text-gray-400 text-sm">No logs found for this request.</p>
                  </div>
                  <div v-else class="logs-list">
                    <div v-for="log in req.logs" :key="log.id" class="log-entry">
                      <span class="log-level-badge" :class="logLevelClass(log.level)">{{ log.level }}</span>
                      <span class="log-datetime">{{ formatLogDatetime(log.datetime) }}</span>
                      <div class="log-body">
                        <span v-if="log.title" class="log-title">{{ log.title }}</span>
                        <span class="log-message">{{ log.message }}</span>
                      </div>
                      <span v-if="log.scriptName" class="log-script">{{ log.scriptName }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </MTabs>

      <!-- No tabs open but requests exist -->
      <div
        v-else-if="openTabs.length === 0 && requests.length > 0"
        class="flex-1 flex items-center justify-center text-gray-500"
      >
        <div class="text-center">
          <i class="pi pi-folder-open text-4xl mb-2"></i>
          <p>No tabs open</p>
          <p class="text-sm">Click a saved request in the sidebar to open it</p>
        </div>
      </div>

      <!-- No requests at all -->
      <div
        v-else-if="requests.length === 0"
        class="flex-1 flex items-center justify-center text-gray-500"
      >
        <div class="text-center">
          <i class="pi pi-send text-4xl mb-3 text-indigo-300"></i>
          <p class="font-medium">No requests yet</p>
          <p class="text-sm mb-3">Create a new request to get started</p>
          <Button size="small" @click="addNewRequest">
            <i class="pi pi-plus mr-1"></i>
            New Request
          </Button>
        </div>
      </div>
        </template>
      </div><!-- end .split-left -->

      <!-- ── SPLIT DIVIDER ── -->
      <div
        class="split-divider"
        :class="{ 'is-dragging': isDraggingSplit }"
        @mousedown.prevent="startDrag"
      >
        <div class="split-divider-handle"></div>
      </div>

      <!-- ── SPLIT RIGHT: Monaco script editor ── -->
      <div class="split-right">
        <div class="editor-pane-header">
          <i class="pi pi-code text-xs" style="color: var(--p-indigo-400)"></i>
          <span class="editor-pane-title">
            {{ currentRequest?.scriptName ?? 'Script Editor' }}
          </span>
          <span v-if="currentRequest?.deploymentScriptId" class="editor-pane-subtitle">
            · {{ currentRequest.deploymentScriptId }}
          </span>
          <span v-if="currentRequest?.scriptFileDirty" class="editor-pane-dirty" title="Unsaved changes">●</span>
          <div class="editor-pane-actions">
            <button
              v-if="currentRequest?.scriptFileId && currentRequest.scriptFileVersions.length > 0"
              class="editor-action-btn"
              :class="{ active: currentRequest?.showVersionHistory }"
              title="Version history"
              @click="currentRequest && (currentRequest.showVersionHistory = !currentRequest.showVersionHistory)"
            >
              <i class="pi pi-history text-xs"></i>
              <span class="editor-version-count">{{ currentRequest.scriptFileVersions.length }}</span>
            </button>
            <button
              v-if="currentRequest?.scriptFileId"
              class="editor-action-btn editor-save-btn"
              :disabled="!currentRequest?.scriptFileDirty || currentRequest?.scriptFileSaving"
              title="Save to NetSuite"
              @click="currentRequest && saveScriptContent(currentRequest)"
            >
              <i :class="currentRequest?.scriptFileSaving ? 'pi pi-spin pi-spinner' : 'pi pi-save'" class="text-xs"></i>
              <span>Save</span>
            </button>
            <i v-if="currentRequest?.scriptFileLoading" class="pi pi-spin pi-spinner text-xs ml-1" style="color: var(--p-indigo-400)"></i>
          </div>
        </div>

        <!-- Version history panel -->
        <div v-if="currentRequest?.showVersionHistory && currentRequest.scriptFileVersions.length > 0" class="version-history-panel">
          <div class="version-history-heading">
            <span>
              <i class="pi pi-history text-xs mr-1"></i>
              Local History ({{ currentRequest.scriptFileVersions.length }} saved versions)
            </span>
            <button
              class="version-clear-all-btn"
              title="Delete all saved versions"
              @click="currentRequest && clearAllHistory(currentRequest)"
            >
              <i class="pi pi-trash text-xs"></i>
              Clear all
            </button>
          </div>
          <div class="version-list">
            <div
              v-for="ver in currentRequest.scriptFileVersions"
              :key="ver.id"
              class="version-item"
              :class="{ 'version-item--active': currentRequest.scriptDiffVersion?.id === ver.id }"
            >
              <span class="version-date">{{ formatVersionDate(ver.savedAt) }}</span>
              <div class="version-actions">
                <button
                  class="version-diff-btn"
                  :class="{ active: currentRequest.scriptDiffVersion?.id === ver.id }"
                  title="Compare with current"
                  @click="currentRequest && (currentRequest.scriptDiffVersion = currentRequest.scriptDiffVersion?.id === ver.id ? null : ver)"
                >
                  <i class="pi pi-code text-xs"></i>
                  Diff
                </button>
                <button
                  class="version-restore-btn"
                  title="Restore this version"
                  @click="currentRequest && restoreVersion(currentRequest, ver)"
                >
                  <i class="pi pi-undo text-xs"></i>
                  Restore
                </button>
                <button
                  class="version-delete-btn"
                  title="Delete this version"
                  @click="currentRequest && deleteHistoryVersion(currentRequest, ver)"
                >
                  <i class="pi pi-times text-xs"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Editor / Diff area -->
        <div class="editor-pane-content">
          <!-- ── Diff mode ── -->
          <template v-if="currentRequest?.scriptDiffVersion">
            <div class="script-diff-bar">
              <span class="script-diff-label">
                <i class="pi pi-clock text-xs mr-1"></i>
                Comparing <strong>{{ formatVersionDate(currentRequest.scriptDiffVersion.savedAt) }}</strong> (left) vs Current (right)
              </span>
              <div class="script-diff-actions">
                <button
                  class="editor-action-btn"
                  title="Restore this version to the editor"
                  @click="currentRequest && restoreVersion(currentRequest, currentRequest.scriptDiffVersion)"
                >
                  <i class="pi pi-undo text-xs"></i>
                  Restore to This
                </button>
                <button
                  class="editor-action-btn"
                  title="Close diff"
                  @click="currentRequest && (currentRequest.scriptDiffVersion = null)"
                >
                  <i class="pi pi-times text-xs"></i>
                  Close
                </button>
              </div>
            </div>
            <div class="script-diff-view">
              <DiffViewer
                :original="currentRequest.scriptDiffVersion.content"
                :modified="currentRequest.scriptFileContent ?? ''"
                language="javascript"
              />
            </div>
          </template>

          <!-- ── Normal Monaco mode ── -->
          <template v-else>
            <MonacoCodeEditor
              v-if="currentRequest?.scriptFileContent != null && !currentRequest?.scriptFileLoading"
              :model-value="currentRequest?.scriptFileContent ?? ''"
              @update:modelValue="onEditorChange"
              @ctrl-s="currentRequest && saveScriptContent(currentRequest)"
              language="javascript"
              :readonly="false"
              :config="{ autoSizing: true, minimap: false, suppressNativeFind: false }"
            />
            <div v-else-if="currentRequest?.scriptFileLoading" class="editor-pane-empty">
              <i class="pi pi-spin pi-spinner text-xl" style="color: var(--p-indigo-400)"></i>
              <span>Loading script…</span>
            </div>
            <div v-else class="editor-pane-empty">
              <i class="pi pi-code text-2xl" style="color: var(--p-slate-300)"></i>
              <span>Select a deployment to view its script</span>
            </div>
          </template>
        </div>
      </div>

    </div>
  </MCard>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, nextTick, watch, onBeforeUnmount } from "vue";
import { Button, InputText, useToast } from "primevue";
import MCard from "../components/universal/card/MCard.vue";
import MSelect from "../components/universal/input/MSelect.vue";
import MInput from "../components/universal/input/MInput.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import MTabs from "../components/universal/tabs/MTabs.vue";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import DiffViewer from "../components/DiffViewer.vue";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { generateId } from "../utils/utilities";
import {
  getAllApiRequests,
  bulkUpsertApiRequests,
  deleteApiRequest,
  getApiTesterUiState,
  setApiTesterUiState,
  addRequestHistoryEntry,
  getAllRequestHistory,
  deleteRequestHistoryEntry,
  clearRequestHistory,
  updateRequestHistoryLogs,
  type RequestHistoryRecord
} from "../utils/apiTesterDb";
import {
  saveVersion,
  getVersionsForFile,
  deleteVersion,
  clearVersionHistory,
  formatVersionDate,
  type FileVersion
} from "../utils/fileVersionsDb";

// ── Toast ─────────────────────────────────────────────────────────────────────
const toast = useToast();

// ── Constants ─────────────────────────────────────────────────────────────────
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const SUITELET_METHODS = ["GET", "POST"];
const BODY_TYPES = ["none", "raw (JSON)", "raw (text)", "form-urlencoded", "key-value (JSON)"];
const KV_BODY_TYPES = ["string", "number", "boolean", "null"];
const REQUEST_TABS = ["Params", "Headers", "Body"];

/** Methods that send data in the request body, not as URL query params */
const BODY_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
const isBodyMethod = (method: string): boolean => BODY_METHODS.includes(method);

// Script types for RESTlets and Suitelets in NetSuite
const RESTLET_TYPE = "RESTLET";
const SUITELET_TYPE = "SCRIPTLET";

// ── Types ─────────────────────────────────────────────────────────────────────
type KVRow = { key: string; value: string };
type KVBodyRow = {
  key: string;
  value: string;
  type: "string" | "number" | "boolean" | "null";
};

type HistoryEntry = {
  id: string;
  method: string;
  url: string;
  timestamp: number;
  status: number | null;
  /** Full response snapshot captured at send time */
  response: HttpResponse | null;
  /** Logs fetched after the request (populated async) */
  logs: LogEntry[] | null;
  /** True while the background log fetch is in-flight */
  logsLoading: boolean;
  /** Request params at send time */
  params: KVRow[];
  /** Request headers at send time */
  headers: KVRow[];
  body: string;
  bodyType: string;
  bodyKv: KVBodyRow[];
  scriptName: string | null;
};

type HttpResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
  url: string;
  error?: string;
};

type LogEntry = {
  id: string;
  datetime: string;
  title: string;
  level: string;
  message: string;
  scriptName: string;
  deploymentName: string;
};

type Deployment = {
  primarykey: string;
  scriptid: string;
  isdeployed: boolean;
  status?: string;
};

type EndpointScript = {
  id: number;
  name: string;
  scriptid: string;
  scriptType: string;
  deployments: Deployment[];
  deploymentsLoaded: boolean;
};

interface ApiRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  params: KVRow[];
  headers: KVRow[];
  body: string;
  bodyType: string;
  /** Internal ID of associated NetSuite script (for log filtering) */
  scriptInternalId: number | null;
  /** "RESTLET" | "SCRIPTLET" | null — controls available HTTP methods */
  scriptType: string | null;
  /** Human-readable script name shown in the URL bar */
  scriptName: string | null;
  /** Deployment script ID shown in the URL bar */
  deploymentScriptId: string | null;
  /** Key-value rows for the "key-value (JSON)" body type */
  bodyKv: KVBodyRow[];
  // runtime-only (not persisted)
  response: HttpResponse | null;
  isLoading: boolean;
  activeRequestTab: string;
  activeResponseTab: string;
  responseFormat: "pretty" | "raw";
  logs: LogEntry[] | null;
  isLoadingLogs: boolean;
  previewSrc: string | null;
  previewLoading: boolean;
  /** Script file source content (fetched via SCRIPT_FILES, runtime-only) */
  scriptFileContent: string | null;
  /** Last content successfully fetched from / saved to NetSuite — used as the version snapshot on next save */
  scriptFileSavedContent: string | null;
  scriptFileLoading: boolean;
  /** File cabinet internal ID — needed for UPDATE_FILE_CONTENT */
  scriptFileId: number | null;
  /** File folder ID — needed by updateNetsuiteFileContent */
  scriptFileFolderId: number | null;
  /** True when the editor has changes not yet saved to NetSuite */
  scriptFileDirty: boolean;
  /** True while a save request is in flight */
  scriptFileSaving: boolean;
  /** Local version history entries (populated from fileVersionsDb) */
  scriptFileVersions: FileVersion[];
  /** Whether the version history panel is expanded */
  showVersionHistory: boolean;
  /** The version currently being diff-compared against the live editor content */
  scriptDiffVersion: FileVersion | null;
}

// ── Request / tab state ────────────────────────────────────────────────────────
const requests = ref<ApiRequest[]>([]);
const openTabs = ref<string[]>([]);
const activeRequestId = ref("");
const requestSearch = ref("");
const isRestoring = ref(true);

// ── Computed ──────────────────────────────────────────────────────────────────
const currentRequest = computed(() =>
  requests.value.find((r) => r.id === activeRequestId.value) ?? null
);

const tabs = computed(() =>
  openTabs.value
    .map((id) => {
      const req = requests.value.find((r) => r.id === id);
      return req ? { name: req.id, label: req.name } : null;
    })
    .filter((t): t is { name: string; label: string } => t !== null)
);

const filteredRequests = computed(() => {
  const term = requestSearch.value.toLowerCase();
  return term
    ? requests.value.filter(
        (r) =>
          r.name.toLowerCase().includes(term) ||
          r.url.toLowerCase().includes(term) ||
          r.method.toLowerCase().includes(term)
      )
    : requests.value;
});

// ── Per-request helpers ───────────────────────────────────────────────────────
const activeParamsOf = (req: ApiRequest) => req.params.filter((r) => r.key.trim());
const activeHeadersOf = (req: ApiRequest) => req.headers.filter((r) => r.key.trim());

/**
 * Returns the available HTTP methods for the given request.
 * Suitelets only support GET and POST; RESTlets and unknown types get the full set.
 */
const methodsForRequest = (req: ApiRequest): string[] =>
  req.scriptType === SUITELET_TYPE ? SUITELET_METHODS : HTTP_METHODS;

const isHtmlResponseOf = (req: ApiRequest): boolean => {
  if (!req.response) return false;
  const ct =
    Object.entries(req.response.headers).find(
      ([k]) => k.toLowerCase() === "content-type"
    )?.[1] ?? "";
  if (ct.toLowerCase().includes("text/html")) return true;
  const trimmed = req.response.body.trimStart();
  return (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<!doctype") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<HTML")
  );
};

const responseTabsOf = (req: ApiRequest): string[] => {
  const tabs: string[] = ["Body", "Headers"];
  if (isHtmlResponseOf(req)) tabs.push("Preview");
  tabs.push("Logs");
  return tabs;
};

const formattedResponseBodyOf = (req: ApiRequest): string => {
  if (!req.response) return "";
  if (req.responseFormat === "raw") return req.response.body;
  try {
    return JSON.stringify(JSON.parse(req.response.body), null, 2);
  } catch {
    return req.response.body;
  }
};

const copyResponse = (req: ApiRequest) => {
  navigator.clipboard.writeText(formattedResponseBodyOf(req));
};

const copyHistoryBody = () => {
  navigator.clipboard.writeText(formattedHistoryBody.value);
};

const copyHistoryHeaders = () => {
  const headers = selectedHistoryEntry.value?.response?.headers ?? {};
  navigator.clipboard.writeText(JSON.stringify(headers, null, 2));
};

// ── Preview: inline CSS via proxy ─────────────────────────────────────────────
/**
 * Fetches all external CSS referenced in the HTML body via the extension proxy
 * and inlines them as <style> blocks so the srcdoc iframe can render styles
 * without needing direct browser access to the NetSuite origin.
 */
const buildInlinedPreview = async (req: ApiRequest): Promise<void> => {
  if (req.previewSrc !== null) return; // already built or building
  req.previewLoading = true;
  try {
    const html = req.response?.body ?? "";
    const baseUrl = req.response?.url ?? "";

    // Inject <base> for any remaining relative URLs (e.g. images, scripts)
    const baseTag = baseUrl ? `<base href="${baseUrl}">` : "";
    let processed = baseUrl && /<head\b/i.test(html)
      ? html.replace(/<head\b[^>]*>/i, (m) => `${m}\n  ${baseTag}`)
      : baseUrl
        ? `${baseTag}\n${html}`
        : html;

    // Find all <link rel="stylesheet" href="..."> tags and inline their CSS
    const linkRegex = /<link[^>]+rel=["']stylesheet["'][^>]*>/gi;
    const matches = [...processed.matchAll(linkRegex)];

    for (const match of matches) {
      const linkTag = match[0];
      const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
      if (!hrefMatch || !hrefMatch[1]) continue;

      let cssUrl: string;
      try {
        cssUrl = baseUrl ? new URL(hrefMatch[1], baseUrl).toString() : hrefMatch[1];
      } catch {
        continue;
      }

      try {
        const res = await callApi(RequestRoutes.EXECUTE_HTTP_REQUEST, {
          method: "GET",
          url: cssUrl,
          headers: {}
        });
        const cssBody: string | undefined = res?.status === "ok"
          ? (res.message as HttpResponse)?.body
          : undefined;
        if (cssBody) {
          processed = processed.replace(linkTag, `<style>\n${cssBody}\n</style>`);
        }
      } catch {
        // skip — leave the original <link> tag in place
      }
    }

    req.previewSrc = processed;
  } catch (err) {
    console.error("[ApiTester] buildInlinedPreview failed:", err);
    req.previewSrc = req.response?.body ?? "";
  } finally {
    req.previewLoading = false;
  }
};

/** Handle response tab clicks; trigger CSS inlining when Preview is selected. */
const onResponseTabClick = (req: ApiRequest, tab: string) => {
  req.activeResponseTab = tab;
  if (tab === "Preview") {
    buildInlinedPreview(req);
  }
};

// ── Log helpers ───────────────────────────────────────────────────────────────
const formatLogDatetime = (value: string): string => {
  try {
    return new Date(value).toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return value;
  }
};

const logLevelClass = (level: string): string => {
  const map: Record<string, string> = {
    DEBUG: "log-level-debug",
    AUDIT: "log-level-audit",
    ERROR: "log-level-error",
    EMERGENCY: "log-level-emergency"
  };
  return map[level?.toUpperCase()] ?? "log-level-debug";
};

// ── Split pane ────────────────────────────────────────────────────────────────
const mainRef = ref<HTMLElement | null>(null);
const splitLeftWidth = ref(600);
const isDraggingSplit = ref(false);
let dragStartX = 0;
let dragStartWidth = 0;

const startDrag = (e: MouseEvent) => {
  isDraggingSplit.value = true;
  dragStartX = e.clientX;
  dragStartWidth = splitLeftWidth.value;
  document.addEventListener("mousemove", onDrag);
  document.addEventListener("mouseup", stopDrag);
};

const onDrag = (e: MouseEvent) => {
  if (!isDraggingSplit.value) return;
  const delta = e.clientX - dragStartX;
  const containerW = mainRef.value?.clientWidth ?? 1200;
  splitLeftWidth.value = Math.max(280, Math.min(containerW - 200, dragStartWidth + delta));
};

const stopDrag = () => {
  isDraggingSplit.value = false;
  document.removeEventListener("mousemove", onDrag);
  document.removeEventListener("mouseup", stopDrag);
};

// ── Script file fetcher ───────────────────────────────────────────────────────
const loadVersionHistory = async (req: ApiRequest): Promise<void> => {
  if (!req.scriptFileId) return;
  try {
    req.scriptFileVersions = await getVersionsForFile(req.scriptFileId);
  } catch (err) {
    console.error("[ApiTester] loadVersionHistory failed:", err);
  }
};

const fetchScriptFile = async (req: ApiRequest, scriptId: number): Promise<void> => {
  req.scriptFileContent = null;
  req.scriptFileSavedContent = null;
  req.scriptFileDirty = false;
  req.scriptFileLoading = true;
  try {
    const res = await callApi(RequestRoutes.SCRIPT_FILES, { scriptIds: [scriptId] });
    const files: any[] = (res as ApiResponse)?.message ?? [];
    const file = files[0];
    const content = file?.scriptFile ?? null;
    req.scriptFileContent = content;
    req.scriptFileSavedContent = content;
    req.scriptFileId = file?.fileId != null ? Number(file.fileId) : null;
    req.scriptFileFolderId = file?.fileFolderId != null ? Number(file.fileFolderId) : null;
    if (req.scriptFileId) {
      await loadVersionHistory(req);
    }
  } catch (err) {
    console.error("[ApiTester] fetchScriptFile failed:", err);
  } finally {
    req.scriptFileLoading = false;
  }
};

// ── Script file save + version history ───────────────────────────────────────
const saveScriptContent = async (req: ApiRequest): Promise<void> => {
  if (!req.scriptFileId || req.scriptFileContent === null) return;
  req.scriptFileSaving = true;
  try {
    // Snapshot the PREVIOUS content (what was in NetSuite) so diff compares
    // "old save" vs "current content" rather than identical text.
    const snapshotContent = req.scriptFileSavedContent;
    if (snapshotContent !== null && snapshotContent !== req.scriptFileContent) {
      await saveVersion(req.scriptFileId, req.scriptName ?? "script.js", snapshotContent);
    }

    const result = await callApi(RequestRoutes.UPDATE_FILE_CONTENT, {
      fileId: req.scriptFileId,
      fileContent: req.scriptFileContent,
      fileName: req.scriptName ?? "script.js",
      folderId: req.scriptFileFolderId,
      mediaType: "JAVASCRIPT"
    });
    const isUpdated = (result as ApiResponse)?.message?.isUpdated;
    if (isUpdated) {
      req.scriptFileDirty = false;
      // Update the ground-truth baseline to the content we just saved
      req.scriptFileSavedContent = req.scriptFileContent;
      await loadVersionHistory(req);
      toast.add({ severity: "success", summary: "Saved", detail: `${req.scriptName ?? "Script"} saved to NetSuite`, life: 2000 });
    } else {
      throw new Error("NetSuite returned a save failure");
    }
  } catch (err: any) {
    console.error("[ApiTester] saveScriptContent failed:", err);
    toast.add({ severity: "error", summary: "Save Failed", detail: err?.message ?? "Could not save script to NetSuite", life: 5000 });
  } finally {
    req.scriptFileSaving = false;
  }
};

const restoreVersion = (req: ApiRequest, version: FileVersion): void => {
  req.scriptFileContent = version.content;
  req.scriptFileDirty = true;
  req.scriptDiffVersion = null;
  req.showVersionHistory = false;
  toast.add({
    severity: "info",
    summary: "Version Restored",
    detail: `Content from ${formatVersionDate(version.savedAt)} loaded — click Save to apply.`,
    life: 3000
  });
};

const deleteHistoryVersion = async (req: ApiRequest, version: FileVersion): Promise<void> => {
  if (!version.id) return;
  try {
    // If this version is currently open in the diff panel, close it first
    if (req.scriptDiffVersion?.id === version.id) {
      req.scriptDiffVersion = null;
    }
    await deleteVersion(version.id);
    await loadVersionHistory(req);
  } catch (err) {
    console.error("[ApiTester] deleteHistoryVersion failed:", err);
    toast.add({ severity: "error", summary: "Delete Failed", detail: "Could not delete version", life: 3000 });
  }
};

const clearAllHistory = async (req: ApiRequest): Promise<void> => {
  if (!req.scriptFileId) return;
  try {
    req.scriptDiffVersion = null;
    await clearVersionHistory(req.scriptFileId);
    await loadVersionHistory(req);
    req.showVersionHistory = false;
    toast.add({ severity: "info", summary: "History Cleared", detail: "All saved versions removed.", life: 2000 });
  } catch (err) {
    console.error("[ApiTester] clearAllHistory failed:", err);
    toast.add({ severity: "error", summary: "Clear Failed", detail: "Could not clear version history", life: 3000 });
  }
};

const onEditorChange = (val: string): void => {
  const req = currentRequest.value;
  if (!req) return;
  if (req.scriptFileContent !== val) {
    req.scriptFileContent = val;
    req.scriptFileDirty = true;
  }
};

// ── History ───────────────────────────────────────────────────────────────────
const history = ref<HistoryEntry[]>([]);

const clearHistory = async () => {
  history.value = [];
  selectedHistoryEntry.value = null;
  await clearRequestHistory();
};

const deleteHistoryEntry = async (entry: HistoryEntry): Promise<void> => {
  history.value = history.value.filter((e) => e.id !== entry.id);
  if (selectedHistoryEntry.value?.id === entry.id) {
    selectedHistoryEntry.value = null;
  }
  await deleteRequestHistoryEntry(entry.id);
};

// ── History viewer ────────────────────────────────────────────────────────────
const selectedHistoryEntry = ref<HistoryEntry | null>(null);
const historyViewerTab = ref("Body");
const historyViewerFormat = ref<"pretty" | "raw">("pretty");
const historyViewerPreviewSrc = ref<string | null>(null);
const historyViewerPreviewLoading = ref(false);

const viewHistoryEntry = (entry: HistoryEntry) => {
  selectedHistoryEntry.value = entry;
  historyViewerTab.value = "Body";
  historyViewerFormat.value = "pretty";
  historyViewerPreviewSrc.value = null;
  historyViewerPreviewLoading.value = false;
};

const reuseHistoryEntry = (entry: HistoryEntry) => {
  const applyTo = (r: ApiRequest) => {
    r.method = entry.method;
    r.url = stripQueryParams(entry.url);
    r.params = entry.params.length ? JSON.parse(JSON.stringify(entry.params)) : [{ key: "", value: "" }];
    r.headers = entry.headers.length ? JSON.parse(JSON.stringify(entry.headers)) : [{ key: "", value: "" }];
    r.body = entry.body;
    r.bodyType = entry.bodyType;
    r.bodyKv = entry.bodyKv?.length ? JSON.parse(JSON.stringify(entry.bodyKv)) : [{ key: "", value: "", type: "string" }];
  };
  const req = currentRequest.value;
  if (!req) {
    addNewRequest();
    nextTick(() => {
      const newReq = requests.value.find((r) => r.id === activeRequestId.value);
      if (newReq) applyTo(newReq);
    });
  } else {
    applyTo(req);
  }
  selectedHistoryEntry.value = null;
};

const formatHistoryTime = (ts: number): string =>
  new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

const isHtmlHistoryResponse = (): boolean => {
  const body = selectedHistoryEntry.value?.response?.body ?? "";
  const t = body.trimStart();
  return t.startsWith("<!DOCTYPE") || t.startsWith("<!doctype") || t.startsWith("<html") || t.startsWith("<HTML");
};

const historyViewerResponseTabs = computed((): string[] => {
  if (!selectedHistoryEntry.value?.response) return [];
  const tabs = ["Body", "Headers"];
  if (isHtmlHistoryResponse()) tabs.push("Preview");
  tabs.push("Logs");
  return tabs;
});

const formattedHistoryBody = computed((): string => {
  const entry = selectedHistoryEntry.value;
  if (!entry?.response) return "";
  if (historyViewerFormat.value === "raw") return entry.response.body;
  try {
    return JSON.stringify(JSON.parse(entry.response.body), null, 2);
  } catch {
    return entry.response.body;
  }
});

const buildInlinedPreviewForHistory = async (): Promise<void> => {
  const entry = selectedHistoryEntry.value;
  if (!entry?.response || historyViewerPreviewSrc.value !== null) return;
  historyViewerPreviewLoading.value = true;
  try {
    const html = entry.response.body;
    const baseUrl = entry.response.url ?? "";
    const baseTag = baseUrl ? `<base href="${baseUrl}">` : "";
    let processed = baseUrl && /<head\b/i.test(html)
      ? html.replace(/<head\b[^>]*>/i, (m) => `${m}\n  ${baseTag}`)
      : baseUrl ? `${baseTag}\n${html}` : html;
    const linkRegex = /<link[^>]+rel=["']stylesheet["'][^>]*>/gi;
    for (const match of [...processed.matchAll(linkRegex)]) {
      const linkTag = match[0];
      const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
      if (!hrefMatch?.[1]) continue;
      let cssUrl: string;
      try { cssUrl = baseUrl ? new URL(hrefMatch[1], baseUrl).toString() : hrefMatch[1]; } catch { continue; }
      try {
        const res = await callApi(RequestRoutes.EXECUTE_HTTP_REQUEST, { method: "GET", url: cssUrl, headers: {} });
        const cssBody: string | undefined = res?.status === "ok" ? (res.message as HttpResponse)?.body : undefined;
        if (cssBody) processed = processed.replace(linkTag, `<style>\n${cssBody}\n</style>`);
      } catch { /* skip */ }
    }
    historyViewerPreviewSrc.value = processed;
  } catch (err) {
    console.error("[ApiTester] buildInlinedPreviewForHistory failed:", err);
    historyViewerPreviewSrc.value = entry.response?.body ?? "";
  } finally {
    historyViewerPreviewLoading.value = false;
  }
};

const onHistoryViewerTabClick = (tab: string) => {
  historyViewerTab.value = tab;
  if (tab === "Preview") buildInlinedPreviewForHistory();
};

// ── Request lifecycle ─────────────────────────────────────────────────────────
const createNewRequest = (): ApiRequest => ({
  id: generateId(),
  name: "New Request",
  method: "GET",
  url: "",
  params: [{ key: "", value: "" }],
  headers: [{ key: "", value: "" }],
  body: "",
  bodyType: "none",
  bodyKv: [{ key: "", value: "", type: "string" }],
  scriptInternalId: null,
  scriptType: null,
  scriptName: null,
  deploymentScriptId: null,
  response: null,
  isLoading: false,
  activeRequestTab: "Params",
  activeResponseTab: "Body",
  responseFormat: "pretty",
  logs: null,
  isLoadingLogs: false,
  previewSrc: null,
  previewLoading: false,
  scriptFileContent: null,
  scriptFileSavedContent: null,
  scriptFileLoading: false,
  scriptFileId: null,
  scriptFileFolderId: null,
  scriptFileDirty: false,
  scriptFileSaving: false,
  scriptFileVersions: [],
  showVersionHistory: false,
  scriptDiffVersion: null
});

const addNewRequest = () => {
  const req = createNewRequest();
  requests.value.push(req);
  openTabs.value.push(req.id);
  activeRequestId.value = req.id;
};

const openRequestInTab = (requestId: string) => {
  if (!openTabs.value.includes(requestId)) {
    openTabs.value.push(requestId);
  }
  activeRequestId.value = requestId;
};

const removeRequest = (requestId: string) => {
  openTabs.value = openTabs.value.filter((id) => id !== requestId);
  const index = requests.value.findIndex((r) => r.id === requestId);
  if (index > -1) requests.value.splice(index, 1);
  if (activeRequestId.value === requestId) {
    activeRequestId.value = openTabs.value[0] || requests.value[0]?.id || "";
  }
  deleteApiRequest(requestId).catch(console.error);
};

const removeRequestByTab = ({ tabId, nextTabId }: { tabId: string; nextTabId: string | null }) => {
  openTabs.value = openTabs.value.filter((id) => id !== tabId);
  if (activeRequestId.value === tabId) {
    activeRequestId.value = nextTabId || openTabs.value[0] || requests.value[0]?.id || "";
  }
};

// ── Send request ──────────────────────────────────────────────────────────────
const buildUrl = (req: ApiRequest): string => {
  const base = req.url.trim();
  // Body methods (POST/PUT/PATCH/DELETE) never append params to the URL
  if (isBodyMethod(req.method)) return base;
  const qp = activeParamsOf(req);
  if (!qp.length) return base;
  try {
    const u = new URL(base);
    qp.forEach(({ key, value }) => u.searchParams.set(key, value));
    return u.toString();
  } catch {
    const query = qp
      .map(({ key, value }) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    return base.includes("?") ? `${base}&${query}` : `${base}?${query}`;
  }
};

/**
 * Strips the query-string from a URL, returning just the base path.
 * Used when re-using a history entry so params aren't double-appended.
 */
const stripQueryParams = (url: string): string => {
  try {
    const u = new URL(url);
    u.search = "";
    return u.toString();
  } catch {
    return url.split("?")[0] ?? url;
  }
};

/** Coerce a string value to the requested JS type for JSON serialisation. */
const coerceKvValue = (value: string, type: KVBodyRow["type"]): any => {
  switch (type) {
    case "number": return Number(value);
    case "boolean": return value === "true" || value === "1";
    case "null": return null;
    default: return value;
  }
};

/**
 * Build a (potentially nested) JSON object from the KV body rows.
 * Dot-notation in the key creates nested objects: "user.name" → { user: { name: … } }
 */
const buildNestedJson = (rows: KVBodyRow[]): string => {
  const result: Record<string, any> = {};
  rows.filter((r) => r.key.trim()).forEach(({ key, value, type }) => {
    const coerced = coerceKvValue(value, type);
    const parts = key.trim().split(".");
    let obj = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!obj[part] || typeof obj[part] !== "object") obj[part] = {};
      obj = obj[part] as Record<string, any>;
    }
    obj[parts[parts.length - 1]!] = coerced;
  });
  return JSON.stringify(result, null, 2);
};

/**
 * Splits a full URL into its base path and parsed query-param rows.
 * Used for bidirectional sync between the URL bar and the Params tab.
 */
const parseUrlAndParams = (full: string): { base: string; params: KVRow[] } => {
  const qIdx = full.indexOf("?");
  if (qIdx === -1) return { base: full, params: [] };
  const base = full.slice(0, qIdx);
  const search = full.slice(qIdx + 1);
  const params: KVRow[] = [];
  if (search) {
    const sp = new URLSearchParams(search);
    sp.forEach((value, key) => params.push({ key, value }));
  }
  return { base, params };
};

/**
 * Called when the user edits the URL bar directly.
 * If the typed value contains a '?', we parse out the query-string and push
 * those key-value pairs into req.params (the single source of truth for query params).
 * If no '?', only req.url (the base) is updated.
 */
const onUrlBarInput = (req: ApiRequest, val: string): void => {
  const trimmed = val.trim();
  if (trimmed.includes("?")) {
    const { base, params } = parseUrlAndParams(trimmed);
    req.url = base;
    req.params = [...params, { key: "", value: "" }];
  } else {
    req.url = trimmed;
  }
};

const buildHeaders = (req: ApiRequest): Record<string, string> => {
  const result: Record<string, string> = {};
  activeHeadersOf(req).forEach(({ key, value }) => {
    result[key.trim()] = value;
  });
  if ((req.bodyType === "raw (JSON)" || req.bodyType === "key-value (JSON)") && isBodyMethod(req.method)) {
    result["Content-Type"] = result["Content-Type"] ?? "application/json";
  } else if (req.bodyType === "form-urlencoded" && req.body) {
    result["Content-Type"] =
      result["Content-Type"] ?? "application/x-www-form-urlencoded";
  }
  return result;
};

const buildBody = (req: ApiRequest): string | undefined => {
  if (!isBodyMethod(req.method)) return undefined;
  if (req.bodyType === "none") return undefined;
  if (req.bodyType === "key-value (JSON)") {
    const activeRows = req.bodyKv.filter((r) => r.key.trim());
    if (!activeRows.length) return undefined;
    return buildNestedJson(req.bodyKv);
  }
  if (!req.body) return undefined;
  return req.body;
};

/**
 * Fetch logs from NetSuite for the given request.
 * Uses sendTime as the start date and a 60-second window to capture all
 * script log.* calls triggered by the request.
 */
const fetchLogsForRequest = async (req: ApiRequest, sendTime: Date, histEntry?: HistoryEntry): Promise<void> => {
  req.isLoadingLogs = true;
  req.logs = null;
  try {
    const res = await callApi(RequestRoutes.LOGS, {
      startDate: sendTime,
      endDate: null,
      scriptIds: req.scriptInternalId ? [req.scriptInternalId] : [],
      deploymentIds: [],
      scriptTypes: []
    });

    const message = (res as ApiResponse)?.message;
    const logs: LogEntry[] = Array.isArray(message)
      ? message.map((log: any) => ({
          id: String(log.internalid ?? ""),
          datetime: log.datetime ?? "",
          title: log.title ?? "",
          level: log.type ?? "DEBUG",
          message: log.detail ?? "",
          scriptName: log["script.name"] ?? "",
          deploymentName: log["scriptDeployment.scriptid"] ?? ""
        }))
      : [];
    req.logs = logs;
    if (histEntry) {
      histEntry.logs = logs;
      histEntry.logsLoading = false;
      // Persist logs back to the DB entry (fire-and-forget)
      updateRequestHistoryLogs(histEntry.id, logs).catch((err) =>
        console.error("[ApiTester] History logs update failed:", err)
      );
    }
  } catch (err) {
    console.error("[ApiTester] fetchLogsForRequest failed:", err);
    req.logs = [];
    if (histEntry) {
      histEntry.logs = [];
      histEntry.logsLoading = false;
      updateRequestHistoryLogs(histEntry.id, []).catch(() => {});
    }
  } finally {
    req.isLoadingLogs = false;
  }
};

const sendRequest = async (requestId: string) => {
  const req = requests.value.find((r) => r.id === requestId);
  if (!req || !req.url.trim()) return;

  req.isLoading = true;
  req.response = null;
  req.logs = null;
  req.previewSrc = null;
  req.previewLoading = false;

  let histEntry: HistoryEntry | null = null;

  const finalUrl = buildUrl(req);
  const sendTime = new Date(); // record before the call for log window

  try {
    const apiResponse = await callApi(RequestRoutes.EXECUTE_HTTP_REQUEST, {
      method: req.method,
      url: finalUrl,
      headers: buildHeaders(req),
      body: buildBody(req)
    });

    if (apiResponse.status === "ok") {
      req.response = apiResponse.message as HttpResponse;
      req.activeResponseTab = "Body";
    } else {
      req.response = {
        status: 0,
        statusText: "Error",
        headers: {},
        body: String(apiResponse.message),
        duration: 0,
        url: finalUrl,
        error: String(apiResponse.message)
      };
      req.activeResponseTab = "Body";
    }

    // Record full snapshot into history (both success and error cases)
    histEntry = {
      id: crypto.randomUUID(),
      method: req.method,
      url: finalUrl,
      timestamp: Date.now(),
      status: req.response.status,
      response: JSON.parse(JSON.stringify(req.response)),
      logs: null,
      logsLoading: true,
      params: JSON.parse(JSON.stringify(req.params)),
      headers: JSON.parse(JSON.stringify(req.headers)),
      body: req.body,
      bodyType: req.bodyType,
      bodyKv: JSON.parse(JSON.stringify(req.bodyKv)),
      scriptName: req.scriptName ?? null
    };
    history.value.unshift(histEntry);
    if (history.value.length > 50) history.value.pop();

    // Persist to IndexedDB (fire-and-forget)
    addRequestHistoryEntry({
      id: histEntry.id,
      method: histEntry.method,
      url: histEntry.url,
      timestamp: histEntry.timestamp,
      status: histEntry.status,
      response: histEntry.response,
      logs: null,
      params: histEntry.params,
      headers: histEntry.headers,
      body: histEntry.body,
      bodyType: histEntry.bodyType,
      bodyKv: histEntry.bodyKv,
      scriptName: histEntry.scriptName
    }).catch((err) => console.error("[ApiTester] History persist failed:", err));
  } finally {
    req.isLoading = false;
    // Fetch logs in the background — don't await so the response renders immediately
    fetchLogsForRequest(req, sendTime, histEntry ?? undefined);
  }
};

// ── Endpoints ─────────────────────────────────────────────────────────────────
const scriptsLoaded = ref(false);
const loadingScripts = ref(false);
const endpointScripts = ref<EndpointScript[]>([]);
const expandedScriptIds = ref<Set<number>>(new Set());
const loadingDeploymentFor = ref<number | null>(null);
const scriptSearch = ref("");

const restlets = computed(() =>
  endpointScripts.value.filter((s) => s.scriptType === RESTLET_TYPE)
);
const suitelets = computed(() =>
  endpointScripts.value.filter((s) => s.scriptType === SUITELET_TYPE)
);

const filteredRestlets = computed(() => {
  const q = scriptSearch.value.trim().toLowerCase();
  return q
    ? restlets.value.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.scriptid.toLowerCase().includes(q)
      )
    : restlets.value;
});

const filteredSuitelets = computed(() => {
  const q = scriptSearch.value.trim().toLowerCase();
  return q
    ? suitelets.value.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.scriptid.toLowerCase().includes(q)
      )
    : suitelets.value;
});

const loadScripts = async () => {
  loadingScripts.value = true;
  try {
    const res = await callApi(RequestRoutes.SCRIPTS);
    const scripts: any[] = (res as ApiResponse)?.message ?? [];
    endpointScripts.value = scripts
      .filter(
        (s) => s.scripttype === RESTLET_TYPE || s.scripttype === SUITELET_TYPE
      )
      .map((s) => ({
        id: s.id,
        name: s.name,
        scriptid: s.scriptid,
        scriptType: s.scripttype,
        deployments: [],
        deploymentsLoaded: false
      }));
    scriptsLoaded.value = true;
  } finally {
    loadingScripts.value = false;
  }
};

const toggleScriptExpand = async (script: EndpointScript) => {
  const newSet = new Set(expandedScriptIds.value);
  if (newSet.has(script.id)) {
    newSet.delete(script.id);
    expandedScriptIds.value = newSet;
    return;
  }
  newSet.add(script.id);
  expandedScriptIds.value = newSet;

  if (!script.deploymentsLoaded) {
    loadingDeploymentFor.value = script.id;
    try {
      const res = await callApi(RequestRoutes.SCRIPT_DEPLOYMENTS, {
        scriptId: script.id
      });
      const deps: any[] = (res as ApiResponse)?.message ?? [];
      script.deployments = deps.map((d) => ({
        primarykey: String(d.primarykey ?? d.id ?? ""),
        scriptid: String(d.scriptid ?? ""),
        isdeployed: Boolean(d.isdeployed),
        status: d.status
      }));
      script.deploymentsLoaded = true;
    } finally {
      loadingDeploymentFor.value = null;
    }
  }
};

/**
 * Populate the active request tab with the deployment URL.
 *
 * Both RESTlets and Suitelets use url.resolveScript() via SUITELET_URL which
 * correctly generates:
 *   - RESTlets  → /app/site/hosting/restlet.nl?script=X&deploy=Y
 *   - Suitelets → /app/site/hosting/scriptlet.nl?script=X&deploy=Y
 *
 * Additionally, we record the script's internal ID and type on the request
 * so that (a) the method dropdown can be restricted for Suitelets, and
 * (b) the Logs tab can filter by the known script after sending.
 */
const useDeployment = async (script: EndpointScript, dep: Deployment) => {
  const res = await callApi(RequestRoutes.SUITELET_URL, {
    script: script.scriptid,
    deployment: dep.scriptid
  });
  const deploymentUrl: string | null = (res as ApiResponse)?.message ?? null;

  if (deploymentUrl) {
    let req = currentRequest.value;
    if (!req) {
      addNewRequest();
      req = currentRequest.value;
    }
    if (req) {
      const { base: deployBase, params: deployParams } = parseUrlAndParams(deploymentUrl);
      req.url = deployBase;
      req.params = [...deployParams, { key: "", value: "" }];
      req.response = null;
      req.logs = null;
      req.previewSrc = null;
      req.scriptFileContent = null;
      req.scriptInternalId = script.id;
      req.scriptType = script.scriptType;
      req.scriptName = script.name;
      req.deploymentScriptId = dep.scriptid;
      // Enforce GET as default for Suitelets; ensure method is valid
      if (script.scriptType === SUITELET_TYPE) {
        if (!SUITELET_METHODS.includes(req.method)) {
          req.method = "GET";
        }
      }
      // Fetch script file content for the Monaco editor (non-blocking)
      fetchScriptFile(req, script.id);
    }
  }
};

// ── CSS helpers ───────────────────────────────────────────────────────────────
const statusClass = (status: number): string => {
  if (status >= 200 && status < 300) return "status-ok";
  if (status >= 300 && status < 400) return "status-redirect";
  if (status >= 400 && status < 500) return "status-client-error";
  if (status >= 500) return "status-server-error";
  return "status-unknown";
};

const methodClass = (m: string): string => {
  const map: Record<string, string> = {
    GET: "method-get",
    POST: "method-post",
    PUT: "method-put",
    PATCH: "method-patch",
    DELETE: "method-delete"
  };
  return map[m] ?? "method-other";
};

// ── Persistence ───────────────────────────────────────────────────────────────
/** Track last time we showed a "Saved" toast to avoid spamming. */
let lastSaveToastTime = 0;

const flushSave = async () => {
  try {
    await bulkUpsertApiRequests(
      requests.value.map((r) => JSON.parse(JSON.stringify({
        requestId: r.id,
        name: r.name,
        method: r.method,
        url: r.url,
        params: r.params,
        headers: r.headers,
        body: r.body,
        bodyType: r.bodyType,
        scriptInternalId: r.scriptInternalId,
        scriptType: r.scriptType,
        scriptName: r.scriptName,
        deploymentScriptId: r.deploymentScriptId,
        scriptFileId: r.scriptFileId ?? null,
        scriptFileFolderId: r.scriptFileFolderId ?? null,
        bodyKv: r.bodyKv ?? [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })))
    );
    // Show success toast at most once every 5 seconds to avoid spam
    const now = Date.now();
    if (now - lastSaveToastTime > 5000) {
      lastSaveToastTime = now;
      toast.add({ severity: "success", summary: "Saved", life: 1500 });
    }
  } catch (err: any) {
    console.error("[ApiTester] flushSave failed:", err);
    toast.add({
      severity: "error",
      summary: "Save Failed",
      detail: err?.message ?? "Could not save to IndexedDB",
      life: 5000
    });
  }
};

let saveTimeout: number | undefined;

const scheduleRequestSave = () => {
  if (isRestoring.value) return;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = window.setTimeout(flushSave, 300);
};

const saveTabState = async () => {
  if (isRestoring.value) return;
  try {
    await setApiTesterUiState("openTabs", [...openTabs.value]);
    await setApiTesterUiState("activeTab", activeRequestId.value);
  } catch (err) {
    console.error("[ApiTester] saveTabState failed:", err);
  }
};

// Watch requests for changes (name, url, method, params, headers, body, bodyType)
watch(
  () =>
    requests.value.map((r) => ({
      id: r.id,
      name: r.name,
      method: r.method,
      url: r.url,
      params: r.params,
      headers: r.headers,
      body: r.body,
      bodyType: r.bodyType,
      bodyKv: r.bodyKv
    })),
  () => {
    scheduleRequestSave();
  },
  { deep: true }
);

// Auto-switch tabs and default bodyType when the HTTP method changes
watch(
  () => requests.value.map((r) => ({ id: r.id, method: r.method })),
  (newMethods, oldMethods) => {
    if (!oldMethods) return;
    newMethods.forEach((nm, idx) => {
      const om = oldMethods[idx];
      if (!om || nm.id !== om.id || nm.method === om.method) return;
      const req = requests.value.find((r) => r.id === nm.id);
      if (!req) return;
      if (isBodyMethod(nm.method) && !isBodyMethod(om.method)) {
        // Switching to a body method: show Body tab and default to JSON if no body type set
        if (req.activeRequestTab === "Params") req.activeRequestTab = "Body";
        if (req.bodyType === "none") req.bodyType = "raw (JSON)";
      } else if (!isBodyMethod(nm.method) && isBodyMethod(om.method)) {
        // Switching back to a non-body method: show Params tab
        if (req.activeRequestTab === "Body") req.activeRequestTab = "Params";
      }
    });
  }
);

watch([openTabs, activeRequestId], () => {
  saveTabState();
}, { deep: true });

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const [storedRequests, storedOpenTabs, storedActiveTab] = await Promise.all([
      getAllApiRequests(),
      getApiTesterUiState<string[]>("openTabs", []),
      getApiTesterUiState<string>("activeTab", "")
    ]);

    const restored: ApiRequest[] = storedRequests.map((r) => {
      // Migration: if stored url embeds query params but params array is empty, extract them
      let restoredUrl = r.url;
      let restoredParams = r.params.length ? r.params : [{ key: "", value: "" }];
      if (r.url.includes("?") && r.params.filter((p) => p.key).length === 0) {
        const { base: migratedBase, params: migratedParams } = parseUrlAndParams(r.url);
        restoredUrl = migratedBase;
        restoredParams = migratedParams.length
          ? [...migratedParams, { key: "", value: "" }]
          : [{ key: "", value: "" }];
      }
      return {
        id: r.requestId,
        name: r.name,
        method: r.method,
        url: restoredUrl,
        params: restoredParams,
        headers: r.headers.length ? r.headers : [{ key: "", value: "" }],
        body: r.body,
        bodyType: r.bodyType,
        bodyKv: r.bodyKv?.length ? r.bodyKv : [{ key: "", value: "", type: "string" as const }],
        scriptInternalId: r.scriptInternalId ?? null,
        scriptType: r.scriptType ?? null,
        scriptName: r.scriptName ?? null,
        deploymentScriptId: r.deploymentScriptId ?? null,
        response: null,
        isLoading: false,
        activeRequestTab: "Params",
        activeResponseTab: "Body",
        responseFormat: "pretty",
        logs: null,
        isLoadingLogs: false,
        previewSrc: null,
        previewLoading: false,
        scriptFileContent: null,
        scriptFileSavedContent: null,
        scriptFileLoading: false,
        scriptFileId: r.scriptFileId ?? null,
        scriptFileFolderId: r.scriptFileFolderId ?? null,
        scriptFileDirty: false,
        scriptFileSaving: false,
        scriptFileVersions: [],
        showVersionHistory: false,
        scriptDiffVersion: null
      };
    });

    requests.value = restored;

    const validTabs = storedOpenTabs.filter((id) =>
      restored.some((r) => r.id === id)
    );
    openTabs.value = validTabs;

    activeRequestId.value =
      typeof storedActiveTab === "string" && validTabs.includes(storedActiveTab)
        ? storedActiveTab
        : validTabs[0] || "";
  } catch (error) {
    console.error("[ApiTester] Restore failed:", error);
    openTabs.value = [];
    activeRequestId.value = "";
  }

  isRestoring.value = false;

  // Set initial split at 60% left / 40% right based on actual container width
  await nextTick();
  const containerW = mainRef.value?.clientWidth ?? 0;
  if (containerW > 0) {
    splitLeftWidth.value = Math.max(280, Math.floor(containerW * 0.6));
  }

  // Auto-fetch script files for any open tab that has an associated script
  const tabsWithScript = openTabs.value
    .map((id) => requests.value.find((r) => r.id === id))
    .filter((r): r is ApiRequest => r != null && r.scriptInternalId != null);
  tabsWithScript.forEach((r) => {
    fetchScriptFile(r, r.scriptInternalId as number);
  });

  // Restore request history from IndexedDB
  try {
    const storedHistory = await getAllRequestHistory();
    history.value = storedHistory.map((h) => ({
      id: h.id,
      method: h.method,
      url: h.url,
      timestamp: h.timestamp,
      status: h.status,
      response: h.response,
      logs: h.logs,
      logsLoading: false,
      params: h.params,
      headers: h.headers,
      body: h.body,
      bodyType: h.bodyType,
      bodyKv: h.bodyKv ?? [],
      scriptName: h.scriptName
    }));
  } catch (err) {
    console.error("[ApiTester] History restore failed:", err);
  }

  loadScripts();
});

onBeforeUnmount(async () => {
  stopDrag();
  if (saveTimeout) { clearTimeout(saveTimeout); saveTimeout = undefined; }
  await flushSave();
  await saveTabState();
});
</script>

<style scoped>
/* ── Main layout ─────────────────────────────────────────────────────────── */
.api-main {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-width: 0;
  overflow: hidden;
}

/* ── Split pane ──────────────────────────────────────────────────────────── */
.split-left {
  display: flex;
  flex-direction: column;
  min-width: 280px;
  overflow: hidden;
  flex-shrink: 0;
}

.split-divider {
  flex-shrink: 0;
  width: 5px;
  background: var(--p-slate-200);
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  user-select: none;
}

.split-divider:hover,
.split-divider.is-dragging {
  background: var(--p-indigo-200);
}

.split-divider-handle {
  width: 3px;
  height: 36px;
  border-radius: 2px;
  background: var(--p-slate-400);
  pointer-events: none;
}

.split-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 200px;
  overflow: hidden;
}

.editor-pane-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.28rem 0.6rem;
  border-bottom: 1px solid var(--p-slate-200);
  font-size: 0.72rem;
  flex-shrink: 0;
  background: var(--p-slate-50);
}

.editor-pane-title {
  font-weight: 500;
  color: var(--p-slate-700);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-pane-subtitle {
  font-size: 0.65rem;
  color: var(--p-indigo-500);
  white-space: nowrap;
  flex-shrink: 0;
}

.editor-pane-dirty {
  font-size: 0.6rem;
  color: var(--p-amber-500);
  flex-shrink: 0;
  line-height: 1;
}

.editor-pane-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: auto;
  flex-shrink: 0;
}

.editor-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.18rem 0.4rem;
  background: none;
  border: 1px solid var(--p-slate-300);
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 0.65rem;
  color: var(--p-slate-600);
  transition: background 0.1s, color 0.1s, border-color 0.1s;
  white-space: nowrap;
}

.editor-action-btn:hover:not(:disabled) {
  background: var(--p-slate-100);
  color: var(--p-slate-800);
  border-color: var(--p-slate-400);
}

.editor-action-btn.active {
  background: var(--p-indigo-50);
  border-color: var(--p-indigo-300);
  color: var(--p-indigo-700);
}

.editor-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.editor-save-btn:not(:disabled) {
  border-color: var(--p-indigo-400);
  color: var(--p-indigo-700);
}

.editor-save-btn:not(:disabled):hover {
  background: var(--p-indigo-50);
}

.editor-version-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--p-slate-200);
  border-radius: 999px;
  font-size: 0.58rem;
  font-weight: 700;
  min-width: 0.9rem;
  height: 0.9rem;
  padding: 0 0.15rem;
}

/* ── Version history panel ───────────────────────────────────────────────── */
.version-history-panel {
  flex-shrink: 0;
  border-bottom: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
  padding: 0.35rem 0.6rem;
  max-height: 160px;
  overflow-y: auto;
}

.version-history-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--p-slate-500);
  margin-bottom: 0.3rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.version-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.2rem 0.3rem;
  border-radius: 0.2rem;
  font-size: 0.68rem;
  border: 1px solid var(--p-slate-200);
  background: white;
}

.version-date {
  color: var(--p-slate-600);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-restore-btn {
  background: none;
  border: 1px solid var(--p-indigo-300);
  border-radius: 0.2rem;
  color: var(--p-indigo-600);
  font-size: 0.62rem;
  padding: 0.1rem 0.35rem;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.1s;
}

.version-restore-btn:hover {
  background: var(--p-indigo-50);
}

.version-delete-btn {
  background: none;
  border: 1px solid transparent;
  border-radius: 0.2rem;
  color: var(--p-slate-400);
  font-size: 0.62rem;
  padding: 0.1rem 0.25rem;
  cursor: pointer;
  flex-shrink: 0;
  line-height: 1;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}

.version-delete-btn:hover {
  background: var(--p-red-50);
  border-color: var(--p-red-200);
  color: var(--p-red-600);
}

.version-clear-all-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  background: none;
  border: 1px solid var(--p-slate-300);
  border-radius: 0.2rem;
  color: var(--p-slate-500);
  font-size: 0.6rem;
  padding: 0.1rem 0.35rem;
  cursor: pointer;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}

.version-clear-all-btn:hover {
  background: var(--p-red-50);
  border-color: var(--p-red-300);
  color: var(--p-red-700);
}

.editor-pane-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.editor-pane-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  height: 100%;
  color: var(--p-slate-400);
  font-size: 0.75rem;
}

/* ── Sidebar sections ────────────────────────────────────────────────────── */
.sidebar-section {
  display: flex;
  flex-direction: column;
  padding: 0.6rem 0.5rem 0.4rem;
}

.endpoints-section {
  flex-shrink: 0;
}

.sidebar-section-files {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.history-section {
  flex-shrink: 0;
  max-height: 160px;
}

.sidebar-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}

.sidebar-section-header h4 {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-slate-400);
  margin: 0;
}

.sidebar-icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--p-slate-400);
  padding: 0.15rem 0.25rem;
  border-radius: 0.2rem;
  transition: color 0.12s, background 0.12s;
  line-height: 1;
}

.sidebar-icon-btn:hover:not(:disabled) {
  color: var(--p-indigo-600);
  background: var(--p-indigo-50);
}

.sidebar-icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sidebar-divider {
  height: 1px;
  background: var(--p-slate-200);
  margin: 0.1rem 0.5rem;
  flex-shrink: 0;
}

/* ── Endpoints search ────────────────────────────────────────────────────── */
.endpoints-search {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  background: var(--p-slate-100);
  border: 1px solid var(--p-slate-200);
  border-radius: 0.3rem;
  padding: 0.2rem 0.4rem;
  margin-bottom: 0.4rem;
  transition: border-color 0.12s;
}

.endpoints-search:focus-within {
  border-color: var(--p-indigo-300);
  background: white;
}

.endpoints-search-icon {
  font-size: 0.6rem;
  color: var(--p-slate-400);
  flex-shrink: 0;
}

.endpoints-search-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 0.72rem;
  color: var(--p-slate-700);
  min-width: 0;
}

.endpoints-search-input::placeholder {
  color: var(--p-slate-400);
}

.endpoints-search-clear {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--p-slate-400);
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.1s;
}

.endpoints-search-clear:hover {
  color: var(--p-slate-600);
}

/* ── Endpoints ───────────────────────────────────────────────────────────── */
.endpoints-loading,
.endpoints-empty {
  font-size: 0.72rem;
  color: var(--p-slate-400);
  text-align: center;
  padding: 0.3rem 0.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
}

.endpoints-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow-y: auto;
  max-height: 200px;
}

.endpoint-group-label {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--p-slate-400);
  padding: 0.25rem 0.2rem 0.15rem;
}

.endpoint-script-btn {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.3rem;
  padding: 0.3rem 0.3rem;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 0.25rem;
  font-size: 0.72rem;
  color: var(--p-slate-700);
  text-align: left;
  transition: background 0.1s;
}

.endpoint-script-btn:hover,
.endpoint-script-btn.is-expanded {
  background: var(--p-slate-100);
}

.endpoint-chevron {
  font-size: 0.55rem;
  color: var(--p-slate-400);
  flex-shrink: 0;
  transition: color 0.1s;
}

.endpoint-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deployment-list {
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
}

.deployment-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.22rem 0.3rem;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 0.2rem;
  font-size: 0.68rem;
  color: var(--p-slate-600);
  text-align: left;
  width: 100%;
  transition: background 0.1s, color 0.1s;
}

.deployment-item:hover {
  background: var(--p-indigo-50);
  color: var(--p-indigo-700);
}

.deployment-id {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deployment-empty {
  font-size: 0.68rem;
  color: var(--p-slate-400);
  padding: 0.2rem 0.3rem;
  font-style: italic;
}

.deployment-inactive {
  font-size: 0.6rem;
  background: var(--p-slate-200);
  color: var(--p-slate-500);
  border-radius: 99px;
  padding: 0.05rem 0.3rem;
  flex-shrink: 0;
}

/* ── Saved requests list ─────────────────────────────────────────────────── */
.saved-req-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.12rem 0.3rem;
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 0.72rem;
  transition: background 0.12s;
}

/* Compact MInput height inside saved-req-items */
.saved-req-item :deep(.m-input--dynamic),
.saved-req-item :deep(.m-input) {
  height: 1.6rem;
}

.saved-req-item :deep(.m-input__display-text) {
  padding: 0.2rem 0.4rem;
}

.saved-req-item:hover {
  background: var(--p-slate-100);
}

.saved-req-item--active {
  background: var(--p-slate-200);
}

.req-method-badge {
  font-size: 0.55rem;
  font-weight: 700;
  padding: 0.08rem 0.25rem;
  border-radius: 0.2rem;
  flex-shrink: 0;
  white-space: nowrap;
}

/* ── History ─────────────────────────────────────────────────────────────── */
.history-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-height: 0;
  max-height: 120px;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.28rem 0.35rem;
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 0.7rem;
  overflow: hidden;
  transition: background 0.12s;
}

.history-item:hover {
  background: var(--p-slate-200);
}

.history-url {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--p-slate-600);
  font-size: 0.65rem;
}

.history-status {
  font-size: 0.65rem;
  font-weight: 600;
  flex-shrink: 0;
}

/* ── Request panel ───────────────────────────────────────────────────────── */
.request-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* ── URL bar ─────────────────────────────────────────────────────────────── */
.url-bar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--p-slate-200);
  flex-shrink: 0;
}

.method-select {
  width: 7rem;
  flex-shrink: 0;
}

.url-input {
  flex: 1;
  min-width: 0;
  font-size: 0.8rem;
}

/* ── Request section ─────────────────────────────────────────────────────── */
.request-section {
  flex-shrink: 0;
  border-bottom: 1px solid var(--p-slate-200);
}

/* ── Response section ────────────────────────────────────────────────────── */
.response-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.response-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--p-slate-400);
}

.response-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 0.5rem 0.75rem;
}

/* ── Shared tab bar ──────────────────────────────────────────────────────── */
.tab-bar {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--p-slate-200);
  padding: 0 0.5rem;
  flex-shrink: 0;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.6rem;
  font-size: 0.75rem;
  color: var(--p-slate-500);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.12s, border-color 0.12s;
  margin-bottom: -1px;
}

.tab-btn:hover {
  color: var(--p-slate-700);
}

.tab-btn.active {
  color: var(--p-indigo-600);
  border-bottom-color: var(--p-indigo-500);
  font-weight: 500;
}

.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--p-indigo-100);
  color: var(--p-indigo-700);
  border-radius: 999px;
  font-size: 0.6rem;
  font-weight: 600;
  min-width: 1rem;
  height: 1rem;
  padding: 0 0.2rem;
}

/* ── KV editor ───────────────────────────────────────────────────────────── */
.kv-editor {
  padding: 0.5rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.kv-header-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 0.4rem;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--p-slate-400);
  letter-spacing: 0.04em;
  padding: 0 0.1rem;
}

.kv-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 0.4rem;
  align-items: center;
}

.kv-input {
  width: 100%;
  font-size: 0.75rem;
}

.kv-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--p-slate-400);
  padding: 0.15rem 0.25rem;
  border-radius: 0.2rem;
  transition: color 0.12s, background 0.12s;
}

.kv-remove:hover {
  color: var(--p-red-500);
  background: var(--p-red-50);
}

/* ── Body editor ─────────────────────────────────────────────────────────── */
.body-editor {
  display: flex;
  flex-direction: column;
  padding: 0.5rem 0.75rem;
  gap: 0.4rem;
}

.body-type-bar {
  display: flex;
  align-items: center;
}

.body-type-select {
  width: 10rem;
}

.body-textarea {
  width: 100%;
  min-height: 80px;
  max-height: 140px;
  resize: vertical;
  font-family: "JetBrains Mono", "Fira Mono", monospace;
  font-size: 0.75rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--p-slate-300);
  border-radius: 0.3rem;
  background: var(--p-slate-50);
  color: var(--p-slate-800);
  outline: none;
  transition: border-color 0.12s;
}

.body-textarea:focus {
  border-color: var(--p-indigo-400);
}

.body-textarea:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Key-value body editor ───────────────────────────────────────────────── */
.kv-body-header {
  font-size: 0.7rem;
  color: var(--p-slate-400);
  padding: 0 0 0.25rem 0;
  border-bottom: 1px solid var(--p-slate-700);
  margin-bottom: 0.25rem;
  display: grid;
  grid-template-columns: 1fr 1fr 7rem 1.5rem;
  gap: 0.35rem;
}
.kv-type-select {
  min-width: 0;
}
.kv-json-preview {
  margin-top: 0.75rem;
  border: 1px solid var(--p-slate-700);
  border-radius: 6px;
  overflow: hidden;
}
.kv-json-preview-label {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-slate-400);
  padding: 0.25rem 0.5rem;
  background: var(--p-slate-800);
  border-bottom: 1px solid var(--p-slate-700);
}
.kv-json-preview-body {
  font-size: 0.72rem;
  font-family: ui-monospace, monospace;
  color: var(--p-slate-200);
  padding: 0.5rem;
  margin: 0;
  background: var(--p-slate-900);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 180px;
  overflow-y: auto;
}

/* ── Response meta ───────────────────────────────────────────────────────── */
.response-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
  flex-shrink: 0;
}

.response-duration {
  font-size: 0.72rem;
  color: var(--p-slate-500);
}

/* ── Response content ────────────────────────────────────────────────────── */
.response-content {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.response-pre {
  font-family: "JetBrains Mono", "Fira Mono", monospace;
  font-size: 0.72rem;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--p-slate-700);
  padding: 0.4rem 0;
  margin: 0;
}

/* ── HTML Preview ────────────────────────────────────────────────────────── */
.preview-content {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-iframe {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 0.25rem;
  background: white;
}

/* ── Response headers table ──────────────────────────────────────────────── */
.header-row {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 0.5rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--p-slate-100);
  font-size: 0.72rem;
}

.header-key {
  font-weight: 500;
  color: var(--p-indigo-700);
  word-break: break-all;
}

.header-value {
  color: var(--p-slate-600);
  word-break: break-all;
}

/* ── Format buttons ──────────────────────────────────────────────────────── */
.fmt-btn {
  background: none;
  border: 1px solid var(--p-slate-300);
  border-radius: 0.25rem;
  font-size: 0.65rem;
  padding: 0.15rem 0.4rem;
  cursor: pointer;
  color: var(--p-slate-500);
  transition: all 0.12s;
}

.fmt-btn:hover {
  background: var(--p-slate-100);
  color: var(--p-slate-700);
}

.fmt-btn.active {
  background: var(--p-indigo-50);
  border-color: var(--p-indigo-300);
  color: var(--p-indigo-700);
}

/* ── Method badges ───────────────────────────────────────────────────────── */
.method-badge {
  font-size: 0.6rem;
  font-weight: 700;
  padding: 0.1rem 0.3rem;
  border-radius: 0.2rem;
  flex-shrink: 0;
}

.method-get    { background: #dcfce7; color: #15803d; }
.method-post   { background: #fef9c3; color: #854d0e; }
.method-put    { background: #dbeafe; color: #1d4ed8; }
.method-patch  { background: #f3e8ff; color: #7e22ce; }
.method-delete { background: #fee2e2; color: #b91c1c; }
.method-other  { background: var(--p-slate-200); color: var(--p-slate-600); }

/* ── Status badges ───────────────────────────────────────────────────────── */
.status-badge {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.15rem 0.5rem;
  border-radius: 0.25rem;
}

.status-ok           { background: #dcfce7; color: #15803d; }
.status-redirect     { background: #dbeafe; color: #1d4ed8; }
.status-client-error { background: #fef9c3; color: #92400e; }
.status-server-error { background: #fee2e2; color: #b91c1c; }
.status-unknown      { background: var(--p-slate-200); color: var(--p-slate-600); }

/* ── Logs tab ────────────────────────────────────────────────────────────── */
.logs-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.4rem 0;
}

.log-entry {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 0.3rem;
  background: var(--p-slate-50);
  border: 1px solid var(--p-slate-100);
  font-size: 0.72rem;
}

.log-level-badge {
  font-size: 0.58rem;
  font-weight: 700;
  padding: 0.1rem 0.35rem;
  border-radius: 0.2rem;
  text-transform: uppercase;
  flex-shrink: 0;
  white-space: nowrap;
}

.log-level-debug     { background: #e0f2fe; color: #0369a1; }
.log-level-audit     { background: #dcfce7; color: #15803d; }
.log-level-error     { background: #fee2e2; color: #b91c1c; }
.log-level-emergency { background: #fef3c7; color: #92400e; }

.log-datetime {
  font-size: 0.65rem;
  color: var(--p-slate-400);
  white-space: nowrap;
  flex-shrink: 0;
}

.log-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.log-title {
  font-weight: 600;
  color: var(--p-slate-700);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-message {
  color: var(--p-slate-600);
  word-break: break-word;
  white-space: pre-wrap;
}

.log-script {
  font-size: 0.6rem;
  color: var(--p-slate-400);
  white-space: nowrap;
  text-align: right;
  flex-shrink: 0;
}

/* ── Version item actions ────────────────────────────────────────────────── */
.version-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

.version-item--active {
  background: var(--p-indigo-50);
  border-color: var(--p-indigo-200);
}

.version-diff-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  background: none;
  border: 1px solid var(--p-slate-300);
  border-radius: 0.2rem;
  color: var(--p-slate-500);
  font-size: 0.62rem;
  padding: 0.1rem 0.35rem;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}

.version-diff-btn:hover {
  background: var(--p-slate-100);
  border-color: var(--p-slate-400);
  color: var(--p-slate-700);
}

.version-diff-btn.active {
  background: var(--p-indigo-50);
  border-color: var(--p-indigo-300);
  color: var(--p-indigo-700);
}

/* ── Script diff bar ─────────────────────────────────────────────────────── */
.script-diff-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.28rem 0.6rem;
  border-bottom: 1px solid var(--p-indigo-200);
  background: var(--p-indigo-50);
  flex-shrink: 0;
  font-size: 0.72rem;
}

.script-diff-label {
  flex: 1;
  color: var(--p-indigo-700);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.script-diff-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

/* ── Script diff view ────────────────────────────────────────────────────── */
.script-diff-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.script-diff-view :deep(.diff-viewer) {
  flex: 1;
  max-height: none;
  height: 100%;
  border-radius: 0;
  border-left: none;
  border-right: none;
  border-bottom: none;
}

/* ── History viewer (replaces split-left content) ────────────────────────── */
.history-viewer {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  height: 100%;
}

.history-viewer-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.65rem;
  border-bottom: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
  flex-shrink: 0;
  min-width: 0;
}

.history-viewer-url {
  flex: 1;
  font-size: 0.72rem;
  font-family: "JetBrains Mono", "Fira Mono", monospace;
  color: var(--p-slate-700);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.history-viewer-time {
  font-size: 0.65rem;
  color: var(--p-slate-400);
  white-space: nowrap;
  flex-shrink: 0;
}

.history-viewer-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

/* ── Active history item in sidebar ─────────────────────────────────────── */
.history-item.is-active {
  background: var(--p-indigo-50);
  color: var(--p-indigo-700);
}

.history-item.is-active .history-url {
  color: var(--p-indigo-600);
}

/* ── History item delete button ──────────────────────────────────────────── */
.history-delete-btn {
  display: none;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--p-slate-400);
  padding: 0.1rem 0.25rem;
  border-radius: 0.2rem;
  flex-shrink: 0;
  transition: color 0.12s, background 0.12s;
}

.history-item:hover .history-delete-btn {
  display: inline-flex;
}

.history-delete-btn:hover {
  color: var(--p-red-500);
  background: var(--p-red-50);
}

/* ── URL preview row ─────────────────────────────────────────────────────── */
.url-preview {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.75rem;
  background: var(--p-slate-50);
  border-bottom: 1px solid var(--p-slate-100);
  flex-shrink: 0;
  min-width: 0;
  overflow: hidden;
}

.url-preview-icon {
  color: var(--p-slate-400);
  flex-shrink: 0;
}

.url-preview-text {
  font-size: 0.65rem;
  font-family: "JetBrains Mono", "Fira Mono", monospace;
  color: var(--p-slate-500);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* ── Body-method hint in Params tab ──────────────────────────────────────── */
.params-body-hint {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.5rem;
  background: var(--p-amber-50);
  border: 1px solid var(--p-amber-200);
  border-radius: 0.3rem;
  font-size: 0.7rem;
  color: var(--p-amber-800);
  margin-bottom: 0.25rem;
}
</style>
