<template>
  <MCard
    flex
    autoHeight
    direction="row"
    gap="0"
    padding=""
    outlined
    elevated
    :style="{ height: `${vhOffset}vh` }"
  >
    <!-- ══════════════════════════════════════════════════════════════
         SIDEBAR — endpoint catalogue + history
    ══════════════════════════════════════════════════════════════ -->
    <ExpandableSidebar expandedWidth="260px" :defaultExpanded="true">
      <template #collapsed>
        <button class="collapsed-icon-btn" title="Endpoints">
          <i class="pi pi-server" />
        </button>
      </template>

      <template #default>
        <!-- Search -->
        <div class="sb-search">
          <i class="pi pi-search sb-search-icon" />
          <input
            v-model="search"
            class="sb-search-input"
            placeholder="Search endpoints…"
            autocomplete="off"
            type="text"
          />
          <button v-if="search" class="sb-search-clear" @click="search = ''">
            <i class="pi pi-times" />
          </button>
        </div>

        <!-- Groups -->
        <div class="sb-groups">
          <template v-for="group in filteredGroups" :key="group.label">
            <div class="sb-group-header">
              <i :class="group.icon" />
              {{ group.label }}
              <span class="sb-group-count">{{ group.endpoints.length }}</span>
            </div>
            <button
              v-for="ep in group.endpoints"
              :key="ep.route"
              class="sb-endpoint"
              :class="{
                'sb-endpoint--active': selectedRoute === ep.route,
                'sb-endpoint--destructive': ep.destructive
              }"
              :title="ep.description"
              @click="selectEndpoint(ep)"
            >
              <span class="sb-endpoint-name">{{ ep.route }}</span>
              <span v-if="ep.destructive" class="sb-destructive-badge" title="Modifies data">!</span>
            </button>
          </template>

          <div v-if="filteredGroups.length === 0" class="sb-empty">
            No matches for "{{ search }}"
          </div>
        </div>

        <!-- Divider -->
        <div class="sb-divider" />

        <!-- History -->
        <div class="sb-history">
          <div class="sb-group-header">
            <i class="pi pi-history" />
            History
            <span class="sb-group-count">{{ callHistory.length }}</span>
            <button
              v-if="callHistory.length > 0"
              class="sb-clear-btn"
              title="Clear history"
              @click="clearHistory"
            >
              <i class="pi pi-trash" />
            </button>
          </div>
          <div class="sb-history-list">
            <div
              v-for="entry in callHistory"
              :key="entry.id"
              class="sb-history-item"
              :class="{ 'sb-history-item--error': entry.status === 'error' }"
              :title="`${entry.route} — ${entry.status}`"
            >
              <button class="sb-history-replay" @click="replayHistory(entry)">
                <span
                  class="sb-history-status"
                  :class="entry.status === 'ok' ? 'status-ok' : 'status-error'"
                >{{ entry.status === 'ok' ? '✓' : '✗' }}</span>
                <span class="sb-history-route">{{ entry.route }}</span>
                <span class="sb-history-dur">{{ entry.duration }}ms</span>
              </button>
              <button
                class="sb-history-delete"
                title="Delete history item"
                @click.stop="deleteHistoryEntry(entry.id)"
              >
                <i class="pi pi-times" />
              </button>
            </div>
            <div v-if="callHistory.length === 0" class="sb-empty">No calls yet</div>
          </div>
        </div>
      </template>
    </ExpandableSidebar>

    <!-- ══════════════════════════════════════════════════════════════
         MAIN AREA
    ══════════════════════════════════════════════════════════════ -->
    <div class="main-area" ref="mainRef">

      <!-- Empty state -->
      <div v-if="!selectedEndpoint" class="empty-state">
        <i class="pi pi-server empty-icon" />
        <p class="empty-title">NetSuite Internal API Tester</p>
        <p class="empty-sub">Select an endpoint from the sidebar to test it.<br/>All calls go through the authenticated NetSuite content-script session.</p>
        <div class="quick-actions">
          <button class="quick-btn" @click="selectEndpoint(findEp('CHECK_CONNECTION'))">
            <i class="pi pi-wifi" /> CHECK_CONNECTION
          </button>
          <button class="quick-btn" @click="selectEndpoint(findEp('CURRENT_USER'))">
            <i class="pi pi-user" /> CURRENT_USER
          </button>
          <button class="quick-btn" @click="selectEndpoint(findEp('AVAILABLE_MODULES'))">
            <i class="pi pi-database" /> AVAILABLE_MODULES
          </button>
        </div>
      </div>

      <template v-else>
        <!-- ── Header bar ── -->
        <div class="endpoint-header">
          <div class="endpoint-header-left">
            <span class="endpoint-route-badge">{{ selectedEndpoint.route }}</span>
            <span v-if="selectedEndpoint.destructive" class="destructive-warning">
              <i class="pi pi-exclamation-triangle" />
              Destructive — modifies data
            </span>
          </div>
          <div class="endpoint-header-right">
            <button class="icon-btn" title="Copy params as JSON" @click="copyParams">
              <i class="pi pi-copy" />
            </button>
            <button class="icon-btn" title="Reset params to template" @click="resetParams">
              <i class="pi pi-refresh" />
            </button>
          </div>
        </div>

        <!-- ── Description ── -->
        <div class="endpoint-desc">{{ selectedEndpoint.description }}</div>

        <!-- ── Split: params | response ── -->
        <div class="split-container" ref="splitRef">

          <!-- Params pane -->
          <div class="pane pane-params" :style="{ height: paramsHeight + 'px' }">
            <div class="pane-header">
              <span class="pane-title">
                <i class="pi pi-sliders-h" />
                Parameters
              </span>
              <div class="pane-header-actions">
                <button
                  class="fmt-btn"
                  :class="{ active: paramsMode === 'form' }"
                  @click="paramsMode = 'form'"
                  title="Form view"
                >Form</button>
                <button
                  class="fmt-btn"
                  :class="{ active: paramsMode === 'json' }"
                  @click="paramsMode = 'json'"
                  title="Raw JSON view"
                >JSON</button>
              </div>
              <button
                class="send-btn"
                :disabled="isSending"
                @click="sendCall"
              >
                <i :class="isSending ? 'pi pi-spin pi-spinner' : 'pi pi-send'" />
                {{ isSending ? 'Calling…' : 'Send' }}
              </button>
            </div>

            <!-- Form mode -->
            <div v-if="paramsMode === 'form'" class="form-params">
              <div v-if="formFields.length === 0" class="no-params">
                <i class="pi pi-check-circle" />
                No parameters required — just hit Send.
              </div>
              <template v-else>
                <div
                  v-for="field in formFields"
                  :key="field.key"
                  class="form-row"
                >
                  <label class="form-label" :title="field.hint">
                    {{ field.key }}
                    <span v-if="field.required" class="required-star">*</span>
                    <span v-if="field.type !== 'string'" class="type-badge">{{ field.type }}</span>
                  </label>
                  <!-- Textarea for multi-line fields -->
                  <textarea
                    v-if="field.multiline"
                    v-model="formValues[field.key]"
                    class="form-textarea"
                    :placeholder="field.hint"
                    rows="5"
                    spellcheck="false"
                  />
                  <!-- Regular input -->
                  <input
                    v-else
                    v-model="formValues[field.key]"
                    class="form-input"
                    :placeholder="field.hint"
                    :type="field.type === 'number' ? 'text' : 'text'"
                  />
                  <span v-if="field.hint" class="form-hint">{{ field.hint }}</span>
                </div>
              </template>

              <!-- Extra params: allow adding arbitrary keys -->
              <div class="extra-params-section">
                <div class="extra-params-header">
                  <span>Extra params</span>
                  <button class="add-param-btn" @click="addExtraParam">
                    <i class="pi pi-plus" /> Add
                  </button>
                </div>
                <div
                  v-for="(row, i) in extraParams"
                  :key="i"
                  class="extra-param-row"
                >
                  <input v-model="row.key" class="extra-key" placeholder="key" />
                  <input v-model="row.value" class="extra-value" placeholder="value" />
                  <button class="remove-btn" @click="extraParams.splice(i, 1)">
                    <i class="pi pi-times" />
                  </button>
                </div>
              </div>
            </div>

            <!-- JSON mode -->
            <div v-else class="json-params">
              <MonacoCodeEditor
                v-model="rawJsonParams"
                language="json"
                :config="{ autoSizing: false, minimap: false }"
                :options="{ lineNumbers: 'on' }"
                :style="{ height: (paramsHeight - 56) + 'px' }"
              />
            </div>
          </div>

          <!-- Resize handle -->
          <div
            class="resize-handle"
            :class="{ dragging: isDragging }"
            @mousedown.prevent="startDrag"
          >
            <div class="resize-handle-dots" />
          </div>

          <!-- Response pane -->
          <div class="pane pane-response" :style="{ flex: 1, minHeight: 0 }">
            <div class="pane-header">
              <span class="pane-title">
                <i class="pi pi-eye" />
                Response
              </span>
              <div v-if="lastResponse" class="response-meta">
                <span
                  class="status-pill"
                  :class="lastResponse.status === 'ok' ? 'status-pill--ok' : 'status-pill--error'"
                >
                  {{ lastResponse.status === 'ok' ? 'OK' : 'ERROR' }}
                </span>
                <span class="duration-pill">{{ lastResponse.duration }}ms</span>
              </div>
              <div class="pane-header-actions" v-if="lastResponse">
                <button
                  class="fmt-btn"
                  :class="{ active: responseFormat === 'pretty' }"
                  @click="responseFormat = 'pretty'"
                >Pretty</button>
                <button
                  class="fmt-btn"
                  :class="{ active: responseFormat === 'raw' }"
                  @click="responseFormat = 'raw'"
                >Raw</button>
                <button class="icon-btn" title="Copy response" @click="copyResponse">
                  <i class="pi pi-copy" />
                </button>
              </div>
            </div>

            <!-- Loading -->
            <div v-if="isSending" class="response-loading">
              <i class="pi pi-spin pi-spinner" />
              <span>Calling {{ selectedEndpoint.route }}…</span>
            </div>

            <!-- Empty -->
            <div v-else-if="!lastResponse" class="response-empty">
              <i class="pi pi-send response-empty-icon" />
              <span>Hit Send to call the endpoint</span>
            </div>

            <!-- Error -->
            <div v-else-if="lastResponse.status === 'error'" class="response-error-block">
              <div class="response-error-header">
                <i class="pi pi-exclamation-circle" />
                Error from NetSuite
              </div>
              <pre class="response-error-message">{{ lastResponse.message }}</pre>
            </div>

            <!-- Success -->
            <div v-else class="response-ok">
              <MonacoCodeEditor
                :model-value="formattedResponse"
                language="json"
                :readonly="true"
                :config="{ autoSizing: false, minimap: false }"
                :options="{ lineNumbers: 'on', readOnly: true }"
                class="response-editor"
              />
            </div>
          </div>
        </div>
      </template>
    </div>
  </MCard>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, onMounted } from "vue";
import MCard from "../components/universal/card/MCard.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import { callApi, ApiRequestType } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { generateId } from "../utils/utilities";
import { useToast } from "primevue";
import {
  addNetsuiteApiHistoryEntry,
  clearNetsuiteApiHistory,
  deleteNetsuiteApiHistoryEntry,
  getAllNetsuiteApiHistory
} from "../utils/apiTesterDb";

// ── Props ──────────────────────────────────────────────────────────────────────
defineProps<{ vhOffset: number }>();

// ── Toast ──────────────────────────────────────────────────────────────────────
const toast = useToast();

// ── Types ──────────────────────────────────────────────────────────────────────
interface FieldDef {
  key: string;
  type: "string" | "number" | "boolean" | "json" | "array";
  required: boolean;
  hint: string;
  multiline: boolean;
  default?: string;
}

interface EndpointDef {
  route: RequestRoutes;
  description: string;
  destructive?: boolean;
  fields: FieldDef[];
}

interface Group {
  label: string;
  icon: string;
  endpoints: EndpointDef[];
}

interface HistoryEntry {
  id: string;
  route: RequestRoutes;
  params: Record<string, any>;
  status: "ok" | "error";
  duration: number;
  message: any;
  timestamp: number;
}

// ── Endpoint catalogue ─────────────────────────────────────────────────────────
const f = (
  key: string,
  type: FieldDef["type"],
  required: boolean,
  hint: string,
  multiline = false,
  defaultVal?: string
): FieldDef => ({ key, type, required, hint, multiline, default: defaultVal });

const ENDPOINTS: EndpointDef[] = [
  // ── General ──
  {
    route: RequestRoutes.CHECK_CONNECTION,
    description: "Checks whether the NetSuite content-script API module is loaded and reachable.",
    fields: []
  },
  {
    route: RequestRoutes.AVAILABLE_MODULES,
    description: "Returns the list of all SuiteScript N/* modules currently available in the page context.",
    fields: []
  },
  {
    route: RequestRoutes.CURRENT_REC_TYPE,
    description: "Returns the record type and internal ID of the record currently open in the NetSuite tab.",
    fields: []
  },
  {
    route: RequestRoutes.CURRENT_USER,
    description: "Returns the currently logged-in user's details (name, email, role, etc.).",
    fields: []
  },
  {
    route: RequestRoutes.FETCH_ACCOUNTS,
    description: "Fetches the list of all NetSuite accounts and roles available to the current user.",
    fields: []
  },

  // ── Scripts ──
  {
    route: RequestRoutes.SCRIPTS,
    description: "Returns all scripts matching an optional scriptId filter.",
    fields: [
      f("scriptid", "string", false, "Optional script ID filter, e.g. customscript_my_script")
    ]
  },
  {
    route: RequestRoutes.SCRIPT_URL,
    description: "Returns the URL for a given script record by its internal ID.",
    fields: [
      f("scriptId", "number", true, "Internal numeric ID of the script record")
    ]
  },
  {
    route: RequestRoutes.SCRIPT_TYPES,
    description: "Returns the list of all script type codes available in this account.",
    fields: []
  },
  {
    route: RequestRoutes.SCRIPT_DEPLOYMENTS,
    description: "Returns deployments for a single script ID or a list of script IDs.",
    fields: [
      f("scriptId", "number", false, "Single script internal ID"),
      f("scriptIds", "array", false, "Comma-separated list of script IDs, e.g. 1,2,3")
    ]
  },
  {
    route: RequestRoutes.SCRIPT_DEPLOYMENT_URL,
    description: "Returns the URL for a specific deployment object.",
    fields: [
      f("deployment", "json", true, "Deployment object JSON, e.g. {\"primarykey\":\"123\"}", true, '{"primarykey": "123"}')
    ]
  },
  {
    route: RequestRoutes.SCRIPTS_DEPLOYED,
    description: "Returns all script files deployed on a given record type.",
    fields: [
      f("recordType", "string", false, "Record type e.g. salesorder, customer. Leave empty for all.")
    ]
  },
  {
    route: RequestRoutes.SCRIPT_FILES,
    description: "Returns the source file content for a list of script internal IDs.",
    fields: [
      f("scriptIds", "array", true, "Comma-separated script internal IDs, e.g. 1,2,3")
    ]
  },
  {
    route: RequestRoutes.SUITELET_URL,
    description: "Returns the URL of a Suitelet deployment.",
    fields: [
      f("script", "string", true, "Script ID, e.g. customscript_my_suitelet"),
      f("deployment", "string", true, "Deployment ID, e.g. customdeploy_my_suitelet")
    ]
  },
  {
    route: RequestRoutes.OPEN_DEPLOYMENT_SUITELET,
    description: "Same as SUITELET_URL — returns the Suitelet URL (caller is responsible for opening it).",
    fields: [
      f("script", "string", true, "Script ID, e.g. customscript_my_suitelet"),
      f("deployment", "string", true, "Deployment ID, e.g. customdeploy_my_suitelet")
    ]
  },
  {
    route: RequestRoutes.CREATE_SCRIPT,
    description: "Creates a new SuiteScript record in NetSuite.",
    destructive: true,
    fields: [
      f("name", "string", true, "Display name for the script record"),
      f("scriptId", "string", true, "Script ID, e.g. customscript_my_script"),
      f("fileId", "number", true, "Internal ID of the uploaded .js file"),
      f("scriptType", "string", true, "Script type e.g. USEREVENT, SUITELET, RESTLET"),
      f("description", "string", false, "Optional description"),
      f("apiVersion", "string", false, "API version, default 2.1")
    ]
  },

  // ── Records ──
  {
    route: RequestRoutes.LOAD_RECORD,
    description: "Loads a NetSuite record by type and internal ID. Returns body fields only (no sublists).",
    fields: [
      f("type", "string", true, "Record type e.g. salesorder, customer, employee"),
      f("id", "number", true, "Internal numeric ID of the record")
    ]
  },
  {
    route: RequestRoutes.GET_RECORD_FIELDS,
    description: "Returns all field definitions (id, label, type) for a given record type.",
    fields: [
      f("type", "string", true, "Record type e.g. salesorder, customer")
    ]
  },
  {
    route: RequestRoutes.GET_RECORD_FIELD_TYPES,
    description: "Returns NetSuite Field.type values for specific body fields on a record type.",
    fields: [
      f("type", "string", true, "Record type e.g. salesorder, customer"),
      f("fieldIds", "array", false, "Comma-separated field IDs, e.g. trandate,createddate")
    ]
  },
  {
    route: RequestRoutes.GET_CUSTOM_LISTS,
    description: "Returns NetSuite custom list metadata: name, internal ID, and inactive status.",
    fields: [
      f("query", "string", false, "Optional partial custom list name or internal ID filter"),
      f("includeInactive", "boolean", false, "Include inactive custom lists")
    ]
  },
  {
    route: RequestRoutes.GET_CUSTOM_LIST_ITEMS,
    description: "Loads a NetSuite custom list and returns its customvalue rows.",
    fields: [
      f("listId", "string", true, "Custom list internal ID from GET_CUSTOM_LISTS, or a supported customlist script ID"),
      f("includeInactive", "boolean", false, "Include inactive list values")
    ]
  },
  {
    route: RequestRoutes.CREATE_RECORD,
    description: "Creates a NetSuite standard or custom record using record.create, setValue, and save.",
    destructive: true,
    fields: [
      f("recordType", "string", true, "Record type e.g. customer, task, customrecord_my_type"),
      f("values", "json", true, "Body field values keyed by field ID", true, "{}"),
      f("defaultValues", "json", false, "Optional record.create defaultValues", true, "{}"),
      f("isDynamic", "boolean", false, "Create in dynamic mode"),
      f("enableSourcing", "boolean", false, "Record.save enableSourcing option. Defaults to true."),
      f("ignoreMandatoryFields", "boolean", false, "Record.save ignoreMandatoryFields option")
    ]
  },
  {
    route: RequestRoutes.UPDATE_RECORD_FIELDS,
    description: "Updates body fields on an existing record using record.submitFields. Does not update sublists or subrecords.",
    destructive: true,
    fields: [
      f("recordType", "string", true, "Record type e.g. customer, salesorder, customrecord_my_type"),
      f("recordId", "number", true, "Internal ID of the record to update"),
      f("values", "json", true, "Body field values keyed by field ID", true, "{}"),
      f("enableSourcing", "boolean", false, "record.submitFields enableSourcing option. Defaults to true."),
      f("ignoreMandatoryFields", "boolean", false, "record.submitFields ignoreMandatoryFields option")
    ]
  },
  {
    route: RequestRoutes.CREATE_CUSTOM_RECORD_TYPE,
    description: "Finds or creates a NetSuite custom record type metadata record using customrecordtype.",
    destructive: true,
    fields: [
      f("name", "string", true, "Record type name, mapped to recordname"),
      f("scriptId", "string", true, "Script ID, e.g. customrecord_my_type or my_type"),
      f("description", "string", false, "Optional description"),
      f("recordFields", "json", false, "Additional customrecordtype fieldId/value pairs", true, "{}")
    ]
  },
  {
    route: RequestRoutes.GET_CUSTOM_RECORD_FIELD_TYPES,
    description: "Returns live fieldtype select options for customrecordcustomfield.",
    fields: [
      f("filter", "string", false, "Optional text filter for field type options")
    ]
  },
  {
    route: RequestRoutes.GET_CUSTOM_RECORD_SELECT_RECORD_TYPES,
    description: "Returns live selectrecordtype options for custom record SELECT and MULTISELECT fields.",
    fields: [
      f("filter", "string", false, "Optional text filter, e.g. Employee, Custom List, Agent Provider")
    ]
  },
  {
    route: RequestRoutes.INSPECT_CUSTOM_RECORD_FIELD,
    description: "Loads an existing customrecordcustomfield and returns its actual field IDs, values, text, metadata, and select options.",
    fields: [
      f("customFieldId", "number", false, "Internal ID of a custom record field metadata record"),
      f("customRecordTypeId", "number", false, "Internal ID of the custom record type; used to find the first matching field"),
      f("scriptId", "string", false, "Optional field script ID to find on the custom record type")
    ]
  },
  {
    route: RequestRoutes.CREATE_CUSTOM_RECORD_FIELD,
    description: "Finds or creates a custom record field using the native custreccustfield.nl form POST.",
    destructive: true,
    fields: [
      f("customRecordTypeId", "number", true, "Internal ID of the custom record type metadata record"),
      f("label", "string", true, "Field label, mapped to label"),
      f("scriptId", "string", true, "Script ID, e.g. custrecord_my_field or my_field"),
      f("fieldType", "string", true, "Value from GET_CUSTOM_RECORD_FIELD_TYPES, e.g. FREEFORMTEXT"),
      f("selectRecordType", "string", false, "For SELECT/MULTISELECT: internal ID, customrecord_my_type, or -my_type"),
      f("description", "string", false, "Optional description"),
      f("storeValue", "boolean", false, "Whether to store values"),
      f("showInList", "boolean", false, "Whether to show in list"),
      f("fieldValues", "json", false, "Additional customrecordcustomfield fieldId/value pairs", true, "{}")
    ]
  },
  {
    route: RequestRoutes.LOAD_RECORD_SUBLISTS,
    description: "Loads the sublist rows for a record. Returns all sublists unless specific IDs are provided.",
    fields: [
      f("type", "string", true, "Record type e.g. salesorder"),
      f("id", "number", true, "Internal numeric ID of the record"),
      f("sublistIds", "array", false, "Comma-separated sublist IDs, e.g. item,expense")
    ]
  },
  {
    route: RequestRoutes.EXPORT_RECORD,
    description: "Exports a record using a config object (see ExportRecordView for config structure).",
    fields: [
      f("config", "json", true, "Export config object", true, '{"type": "customer", "id": 123}')
    ]
  },
  {
    route: RequestRoutes.GET_ALL_RECORD_TYPES,
    description: "Returns all standard record types available in the account.",
    fields: []
  },
  {
    route: RequestRoutes.CUSTOM_RECORDS,
    description: "Returns all custom record type definitions.",
    fields: []
  },
  {
    route: RequestRoutes.CUSTOM_RECORD_URL,
    description: "Returns the URL for a custom record type by its internal record ID.",
    fields: [
      f("recordId", "number", true, "Internal ID of the custom record type")
    ]
  },
  {
    route: RequestRoutes.CUSTOM_RECORD_LIST_URL,
    description: "Returns the list-view URL for a custom record type.",
    fields: [
      f("recordId", "number", true, "Internal ID of the custom record type")
    ]
  },

  // ── File Cabinet ──
  {
    route: RequestRoutes.ROOT_FOLDERS,
    description: "Returns all root-level folders in the NetSuite File Cabinet.",
    fields: []
  },
  {
    route: RequestRoutes.MEDIA_ITEMS,
    description: "Returns both files and folders from the File Cabinet.",
    fields: []
  },
  {
    route: RequestRoutes.LIST_FOLDER,
    description: "Lists all files and subfolders inside a given folder ID.",
    fields: [
      f("folderId", "number", true, "Internal numeric ID of the folder to list")
    ]
  },
  {
    route: RequestRoutes.FIND_FILE,
    description: "Finds files by internal ID and/or name (LIKE match). At least one param required.",
    fields: [
      f("id", "number", false, "Exact file internal ID"),
      f("name", "string", false, "Partial file name, case-insensitive LIKE match")
    ]
  },
  {
    route: RequestRoutes.FIND_FOLDER,
    description: "Finds folders by internal ID and/or name (LIKE match). At least one param required.",
    fields: [
      f("id", "number", false, "Exact folder internal ID"),
      f("name", "string", false, "Partial folder name, case-insensitive LIKE match")
    ]
  },
  {
    route: RequestRoutes.FETCH_FILE_CONTENT,
    description: "Fetches the raw content of a file from the File Cabinet via the authenticated session. Pass a relative URL like /core/media/media.nl?id=12345",
    fields: [
      f("fileUrl", "string", true, "Relative URL e.g. /core/media/media.nl?id=12345")
    ]
  },
  {
    route: RequestRoutes.CREATE_FOLDER,
    description: "Creates a new folder in the File Cabinet.",
    destructive: true,
    fields: [
      f("name", "string", true, "Name of the new folder"),
      f("parentFolder", "number", false, "Parent folder ID. Omit for root.")
    ]
  },
  {
    route: RequestRoutes.UPLOAD_FILE,
    description: "Uploads a file to the File Cabinet.",
    destructive: true,
    fields: [
      f("fileName", "string", true, "File name including extension"),
      f("fileContent", "string", false, "Text content (for text files)"),
      f("mimeType", "string", false, "MIME type e.g. application/javascript"),
      f("folderId", "number", false, "Target folder ID. Default: SuiteScripts (-15)")
    ]
  },
  {
    route: RequestRoutes.UPDATE_FILE_CONTENT,
    description: "Updates the content of an existing file by its internal ID.",
    destructive: true,
    fields: [
      f("fileId", "number", true, "Internal ID of the file to update"),
      f("fileContent", "string", true, "New file content", true),
      f("fileName", "string", false, "File name (used to determine media type)"),
      f("folderId", "number", false, "Folder ID — required by some update paths"),
      f("mediaType", "string", false, "e.g. JAVASCRIPT, PLAINTEXT. Default: JAVASCRIPT")
    ]
  },
  {
    route: RequestRoutes.DELETE_FILE,
    description: "Deletes a file from the File Cabinet.",
    destructive: true,
    fields: [
      f("fileId", "number", true, "Internal ID of the file to delete"),
      f("folderId", "number", false, "Folder ID of the file (optional)")
    ]
  },
  {
    route: RequestRoutes.DELETE_FOLDER,
    description: "Deletes a folder from the File Cabinet.",
    destructive: true,
    fields: [
      f("folderId", "number", true, "Internal ID of the folder to delete")
    ]
  },
  {
    route: RequestRoutes.RENAME_FILE,
    description: "Renames a file in the File Cabinet.",
    destructive: true,
    fields: [
      f("fileId", "number", true, "Internal ID of the file"),
      f("newName", "string", true, "New file name including extension"),
      f("folderId", "number", false, "Folder ID of the file"),
      f("filetype", "string", false, "File type code"),
      f("filesize", "number", false, "File size in bytes")
    ]
  },
  {
    route: RequestRoutes.RENAME_FOLDER,
    description: "Renames a folder in the File Cabinet.",
    destructive: true,
    fields: [
      f("folderId", "number", true, "Internal ID of the folder"),
      f("newName", "string", true, "New folder name"),
      f("parentFolderId", "number", false, "Parent folder ID")
    ]
  },
  {
    route: RequestRoutes.MOVE_ITEMS,
    description: "Moves files and/or folders from one folder to another.",
    destructive: true,
    fields: [
      f("srcFolderId", "number", true, "Source folder ID"),
      f("dstFolderId", "number", true, "Destination folder ID"),
      f("fileIds", "array", false, "Comma-separated file IDs to move, e.g. 1,2,3"),
      f("folderIds", "array", false, "Comma-separated subfolder IDs to move")
    ]
  },

  // ── SuiteQL ──
  {
    route: RequestRoutes.FETCH_SUITEQL_TABLES,
    description: "Returns all tables available to SuiteQL queries.",
    fields: []
  },
  {
    route: RequestRoutes.FETCH_SUITEQL_TABLE_DETAIL,
    description: "Returns column definitions for a specific SuiteQL table.",
    fields: [
      f("tableName", "string", true, "Table name e.g. transaction, customer, employee")
    ]
  },
  {
    route: RequestRoutes.RUN_SUITEQL_QUERY,
    description: "Executes a raw SuiteQL SELECT query. Use ROWNUM <= N instead of LIMIT.",
    fields: [
      f("sql", "string", true, "SuiteQL query e.g. SELECT id, entityid FROM customer WHERE ROWNUM <= 10", true, "SELECT id, entityid FROM customer WHERE ROWNUM <= 10"),
      f("limit", "number", false, "Max rows to return. Default: 1000")
    ]
  },
  {
    route: RequestRoutes.GET_SUITEQL_COUNT,
    description: "Returns the row count for a SuiteQL query wrapping it in SELECT COUNT(*).",
    fields: [
      f("sql", "string", true, "SuiteQL base query (without COUNT wrapper)", true, "SELECT id FROM customer")
    ]
  },

  // ── Logs ──
  {
    route: RequestRoutes.LOGS,
    description: "Fetches script execution logs filtered by date range, script IDs, deployment IDs, or script types.",
    fields: [
      f("startDate", "string", false, "ISO date string e.g. 2024-01-01T00:00:00.000Z"),
      f("endDate", "string", false, "ISO date string e.g. 2024-12-31T23:59:59.999Z"),
      f("scriptIds", "array", false, "Comma-separated script internal IDs"),
      f("deploymentIds", "array", false, "Comma-separated deployment IDs"),
      f("scriptTypes", "array", false, "Comma-separated script types e.g. USEREVENT,SUITELET")
    ]
  },

  // ── Templates ──
  {
    route: RequestRoutes.ADVANCED_PDF_TEMPLATES,
    description: "Returns all Advanced PDF/HTML Template records.",
    fields: []
  },
  {
    route: RequestRoutes.GET_TEMPLATES_CONTENT,
    description: "Returns the content (HTML/FreeMarker) of a specific PDF template.",
    fields: [
      f("templateId", "number", true, "Internal ID of the template record")
    ]
  },
  {
    route: RequestRoutes.SAVE_TEMPLATE,
    description: "Saves/updates an Advanced PDF template.",
    destructive: true,
    fields: [
      f("templateId", "number", true, "Internal ID of the template record"),
      f("content", "string", true, "New template content (HTML/FreeMarker)", true)
    ]
  },
  {
    route: RequestRoutes.PREVIEW,
    description: "Previews a PDF template with optional record data.",
    fields: [
      f("templateId", "number", true, "Internal ID of the template record")
    ]
  },

  // ── Code Execution ──
  {
    route: RequestRoutes.RUN_QUICK_SCRIPT,
    description: "Runs arbitrary SuiteScript code in the page context. Use with caution.",
    destructive: true,
    fields: [
      f("code", "string", true, "SuiteScript 2.1 code to execute", true,
        "require(['N/record'], function(record) {\n  // your code here\n});"),
      f("mode", "string", false, "Execution mode: 'normal' or 'stream'. Default: normal")
    ]
  },
  {
    route: RequestRoutes.RUN_QUICK_SCRIPT_SERVER,
    description: "Runs a Quick Script through the server-side execution path.",
    destructive: true,
    fields: [
      f("code", "string", true, "SuiteScript 2.1 code to execute server-side", true),
      f("userId", "number", false, "User ID to execute as")
    ]
  },

  // ── HTTP ──
  {
    route: RequestRoutes.EXECUTE_HTTP_REQUEST,
    description: "Executes an HTTP request through the NetSuite content-script proxy. Useful for calling NetSuite REST APIs.",
    fields: [
      f("method", "string", true, "HTTP method: GET, POST, PUT, PATCH, DELETE"),
      f("url", "string", true, "Full URL to request"),
      f("headers", "json", false, "Headers object e.g. {\"Content-Type\": \"application/json\"}", false, '{}'),
      f("body", "string", false, "Request body for POST/PUT/PATCH", true)
    ]
  },

  // ── Server Components ──
  {
    route: RequestRoutes.CHECK_SERVER_COMPONENTS,
    description: "Checks whether the Magic NetSuite server-side components are installed.",
    fields: []
  },
  {
    route: RequestRoutes.REMOVE_SERVER_COMPONENTS,
    description: "Removes the Magic NetSuite server-side components from this account.",
    destructive: true,
    fields: []
  }
];

// Group definitions
const GROUPS: { label: string; icon: string; routes: RequestRoutes[] }[] = [
  {
    label: "General",
    icon: "pi pi-bolt",
    routes: [
      RequestRoutes.CHECK_CONNECTION,
      RequestRoutes.AVAILABLE_MODULES,
      RequestRoutes.CURRENT_REC_TYPE,
      RequestRoutes.CURRENT_USER,
      RequestRoutes.FETCH_ACCOUNTS
    ]
  },
  {
    label: "Scripts",
    icon: "pi pi-code",
    routes: [
      RequestRoutes.SCRIPTS,
      RequestRoutes.SCRIPT_URL,
      RequestRoutes.SCRIPT_TYPES,
      RequestRoutes.SCRIPT_DEPLOYMENTS,
      RequestRoutes.SCRIPT_DEPLOYMENT_URL,
      RequestRoutes.SCRIPTS_DEPLOYED,
      RequestRoutes.SCRIPT_FILES,
      RequestRoutes.SUITELET_URL,
      RequestRoutes.OPEN_DEPLOYMENT_SUITELET,
      RequestRoutes.CREATE_SCRIPT
    ]
  },
  {
    label: "Records",
    icon: "pi pi-table",
    routes: [
      RequestRoutes.LOAD_RECORD,
      RequestRoutes.GET_RECORD_FIELDS,
      RequestRoutes.GET_RECORD_FIELD_TYPES,
      RequestRoutes.GET_CUSTOM_LISTS,
      RequestRoutes.GET_CUSTOM_LIST_ITEMS,
      RequestRoutes.CREATE_RECORD,
      RequestRoutes.UPDATE_RECORD_FIELDS,
      RequestRoutes.CREATE_CUSTOM_RECORD_TYPE,
      RequestRoutes.GET_CUSTOM_RECORD_FIELD_TYPES,
      RequestRoutes.GET_CUSTOM_RECORD_SELECT_RECORD_TYPES,
      RequestRoutes.INSPECT_CUSTOM_RECORD_FIELD,
      RequestRoutes.CREATE_CUSTOM_RECORD_FIELD,
      RequestRoutes.LOAD_RECORD_SUBLISTS,
      RequestRoutes.GET_ALL_RECORD_TYPES,
      RequestRoutes.CUSTOM_RECORDS,
      RequestRoutes.CUSTOM_RECORD_URL,
      RequestRoutes.CUSTOM_RECORD_LIST_URL,
      RequestRoutes.EXPORT_RECORD
    ]
  },
  {
    label: "File Cabinet",
    icon: "pi pi-folder",
    routes: [
      RequestRoutes.ROOT_FOLDERS,
      RequestRoutes.MEDIA_ITEMS,
      RequestRoutes.LIST_FOLDER,
      RequestRoutes.FIND_FILE,
      RequestRoutes.FIND_FOLDER,
      RequestRoutes.FETCH_FILE_CONTENT,
      RequestRoutes.CREATE_FOLDER,
      RequestRoutes.UPLOAD_FILE,
      RequestRoutes.UPDATE_FILE_CONTENT,
      RequestRoutes.DELETE_FILE,
      RequestRoutes.DELETE_FOLDER,
      RequestRoutes.RENAME_FILE,
      RequestRoutes.RENAME_FOLDER,
      RequestRoutes.MOVE_ITEMS
    ]
  },
  {
    label: "SuiteQL",
    icon: "pi pi-server",
    routes: [
      RequestRoutes.FETCH_SUITEQL_TABLES,
      RequestRoutes.FETCH_SUITEQL_TABLE_DETAIL,
      RequestRoutes.RUN_SUITEQL_QUERY,
      RequestRoutes.GET_SUITEQL_COUNT
    ]
  },
  {
    label: "Logs",
    icon: "pi pi-list",
    routes: [RequestRoutes.LOGS]
  },
  {
    label: "Templates",
    icon: "pi pi-file-pdf",
    routes: [
      RequestRoutes.ADVANCED_PDF_TEMPLATES,
      RequestRoutes.GET_TEMPLATES_CONTENT,
      RequestRoutes.SAVE_TEMPLATE,
      RequestRoutes.PREVIEW
    ]
  },
  {
    label: "Code Execution",
    icon: "pi pi-play",
    routes: [RequestRoutes.RUN_QUICK_SCRIPT, RequestRoutes.RUN_QUICK_SCRIPT_SERVER]
  },
  {
    label: "HTTP",
    icon: "pi pi-globe",
    routes: [RequestRoutes.EXECUTE_HTTP_REQUEST]
  },
  {
    label: "Server",
    icon: "pi pi-cog",
    routes: [RequestRoutes.CHECK_SERVER_COMPONENTS, RequestRoutes.REMOVE_SERVER_COMPONENTS]
  }
];

// ── State ──────────────────────────────────────────────────────────────────────
const search = ref("");
const selectedRoute = ref<RequestRoutes | null>(null);
const selectedEndpoint = ref<EndpointDef | null>(null);

const formValues = ref<Record<string, string>>({});
const extraParams = ref<{ key: string; value: string }[]>([]);
const paramsMode = ref<"form" | "json">("form");
const rawJsonParams = ref("{}");

const isSending = ref(false);
const lastResponse = ref<{ status: "ok" | "error"; message: any; duration: number } | null>(null);
const responseFormat = ref<"pretty" | "raw">("pretty");

const NETSUITE_HISTORY_LIMIT = 100;
const callHistory = ref<HistoryEntry[]>([]);

const splitRef = ref<HTMLElement | null>(null);
const paramsHeight = ref(260);
const isDragging = ref(false);
let dragStartY = 0;
let dragStartH = 0;

// ── Computed ──────────────────────────────────────────────────────────────────
const endpointMap = computed<Record<string, EndpointDef>>(() => {
  const m: Record<string, EndpointDef> = {};
  for (const ep of ENDPOINTS) m[ep.route] = ep;
  return m;
});

const filteredGroups = computed<Group[]>(() => {
  const q = search.value.toLowerCase().trim();
  return GROUPS.map((g) => {
    const eps = g.routes
      .map((r) => endpointMap.value[r])
      .filter((ep): ep is EndpointDef => ep !== undefined)
      .filter((ep) => !q || ep.route.toLowerCase().includes(q) || ep.description.toLowerCase().includes(q));
    return { label: g.label, icon: g.icon, endpoints: eps };
  }).filter((g) => g.endpoints.length > 0);
});

const formFields = computed<FieldDef[]>(() => selectedEndpoint.value?.fields ?? []);

const formattedResponse = computed<string>(() => {
  if (!lastResponse.value) return "";
  const msg = lastResponse.value.message;
  if (responseFormat.value === "raw") return typeof msg === "string" ? msg : JSON.stringify(msg);
  try {
    return JSON.stringify(msg, null, 2);
  } catch {
    return String(msg);
  }
});

// ── Watchers ──────────────────────────────────────────────────────────────────
// Sync form → JSON when switching to JSON mode
watch(paramsMode, (mode) => {
  if (mode === "json") {
    rawJsonParams.value = JSON.stringify(buildPayloadFromForm(), null, 2);
  }
});

onMounted(async () => {
  try {
    const stored = await getAllNetsuiteApiHistory();
    callHistory.value = stored.map((entry) => ({
      ...entry,
      route: entry.route as RequestRoutes
    }));
  } catch (err) {
    console.error("[NetsuiteApiTester] History restore failed:", err);
  }
});

// ── Methods ──────────────────────────────────────────────────────────────────
const findEp = (route: string): EndpointDef =>
  ENDPOINTS.find((e) => e.route === route) as EndpointDef;

const selectEndpoint = (ep: EndpointDef | null | undefined) => {
  if (!ep) return;
  selectedEndpoint.value = ep;
  selectedRoute.value = ep.route;
  lastResponse.value = null;
  paramsMode.value = "form";
  responseFormat.value = "pretty";

  // Reset form values with defaults
  const vals: Record<string, string> = {};
  for (const field of ep.fields) {
    vals[field.key] = field.default ?? "";
  }
  formValues.value = vals;
  extraParams.value = [];
  rawJsonParams.value = "{}";
};

const buildPayloadFromForm = (): Record<string, any> => {
  const result: Record<string, any> = {};

  for (const field of formFields.value) {
    const raw = (formValues.value[field.key] ?? "").trim();
    if (!raw) continue;

    if (field.type === "number") {
      const n = Number(raw);
      result[field.key] = isNaN(n) ? raw : n;
    } else if (field.type === "boolean") {
      result[field.key] = raw === "true" || raw === "1";
    } else if (field.type === "array") {
      result[field.key] = raw.split(",").map((s) => {
        const trimmed = s.trim();
        const n = Number(trimmed);
        return isNaN(n) ? trimmed : n;
      });
    } else if (field.type === "json") {
      try {
        result[field.key] = JSON.parse(raw);
      } catch {
        result[field.key] = raw;
      }
    } else {
      result[field.key] = raw;
    }
  }

  // Extra params
  for (const row of extraParams.value) {
    if (!row.key.trim()) continue;
    const val = row.value.trim();
    // Try number, then JSON, then string
    const n = Number(val);
    if (!isNaN(n) && val !== "") {
      result[row.key] = n;
    } else {
      try {
        result[row.key] = JSON.parse(val);
      } catch {
        result[row.key] = val;
      }
    }
  }

  return result;
};

const buildPayload = (): Record<string, any> => {
  if (paramsMode.value === "json") {
    try {
      return JSON.parse(rawJsonParams.value);
    } catch {
      toast.add({ severity: "error", summary: "Invalid JSON", detail: "Params JSON is malformed", life: 3000 });
      throw new Error("Invalid JSON params");
    }
  }
  return buildPayloadFromForm();
};

const sendCall = async () => {
  if (!selectedEndpoint.value || isSending.value) return;

  let payload: Record<string, any>;
  try {
    payload = buildPayload();
  } catch {
    return;
  }

  isSending.value = true;
  lastResponse.value = null;

  const start = performance.now();

  // ── Detect stream mode for RUN_QUICK_SCRIPT ──
  const isStreamMode =
    selectedEndpoint.value.route === RequestRoutes.RUN_QUICK_SCRIPT &&
    payload.mode === "stream";

  try {
    let res;

    if (isStreamMode) {
      // Collect streamed log entries in real-time
      const streamLogs: unknown[] = [];
      lastResponse.value = { status: "ok", message: streamLogs, duration: 0 };

      res = await callApi(
        selectedEndpoint.value.route,
        payload,
        ApiRequestType.STREAM,
        (message: any) => {
          if (message.event === "log" || message.event === "streamChunk") {
            streamLogs.push(message.data ?? message);
            // Trigger reactivity — replace array reference
            lastResponse.value = {
              status: "ok",
              message: [...streamLogs],
              duration: Math.round(performance.now() - start)
            };
          }
        }
      );
    } else {
      res = await callApi(selectedEndpoint.value.route, payload);
    }

    const duration = Math.round(performance.now() - start);

    lastResponse.value = {
      status: res.status as "ok" | "error",
      message: res.message,
      duration
    };

    const historyEntry: HistoryEntry = {
      id: generateId(),
      route: selectedEndpoint.value.route,
      params: payload,
      status: res.status as "ok" | "error",
      duration,
      message: res.message,
      timestamp: Date.now()
    };
    callHistory.value.unshift(historyEntry);
    addNetsuiteApiHistoryEntry(historyEntry).catch((err) =>
      console.error("[NetsuiteApiTester] History persist failed:", err)
    );

    if (callHistory.value.length > NETSUITE_HISTORY_LIMIT) {
      callHistory.value.length = NETSUITE_HISTORY_LIMIT;
    }
  } catch (err) {
    const duration = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    lastResponse.value = { status: "error", message, duration };

    const historyEntry: HistoryEntry = {
      id: generateId(),
      route: selectedEndpoint.value.route,
      params: payload,
      status: "error",
      duration,
      message,
      timestamp: Date.now()
    };
    callHistory.value.unshift(historyEntry);
    addNetsuiteApiHistoryEntry(historyEntry).catch((persistErr) =>
      console.error("[NetsuiteApiTester] History persist failed:", persistErr)
    );
    if (callHistory.value.length > NETSUITE_HISTORY_LIMIT) {
      callHistory.value.length = NETSUITE_HISTORY_LIMIT;
    }
  } finally {
    isSending.value = false;
  }
};

const clearHistory = async () => {
  callHistory.value = [];
  try {
    await clearNetsuiteApiHistory();
  } catch (err) {
    console.error("[NetsuiteApiTester] History clear failed:", err);
    toast.add({ severity: "error", summary: "Clear Failed", detail: "Could not clear history", life: 3000 });
  }
};

const deleteHistoryEntry = async (id: string) => {
  callHistory.value = callHistory.value.filter((entry) => entry.id !== id);
  try {
    await deleteNetsuiteApiHistoryEntry(id);
  } catch (err) {
    console.error("[NetsuiteApiTester] History delete failed:", err);
    toast.add({ severity: "error", summary: "Delete Failed", detail: "Could not delete history item", life: 3000 });
  }
};

const replayHistory = (entry: HistoryEntry) => {
  const ep = endpointMap.value[entry.route];
  if (!ep) return;
  selectEndpoint(ep);

  // Populate form values from history params
  const vals: Record<string, string> = {};
  for (const field of ep.fields) {
    const v = entry.params[field.key];
    if (v !== undefined && v !== null) {
      vals[field.key] = Array.isArray(v) ? v.join(", ") : String(v);
    } else {
      vals[field.key] = field.default ?? "";
    }
  }
  formValues.value = vals;

  // Any extra params not in schema
  const known = new Set(ep.fields.map((f) => f.key));
  const extras: { key: string; value: string }[] = [];
  for (const [k, v] of Object.entries(entry.params)) {
    if (!known.has(k)) {
      extras.push({ key: k, value: typeof v === "object" ? JSON.stringify(v) : String(v) });
    }
  }
  extraParams.value = extras;

  // Also restore the previous response for context
  lastResponse.value = {
    status: entry.status,
    message: entry.message,
    duration: entry.duration
  };
};

const addExtraParam = () => extraParams.value.push({ key: "", value: "" });

const resetParams = () => {
  if (!selectedEndpoint.value) return;
  const vals: Record<string, string> = {};
  for (const field of selectedEndpoint.value.fields) {
    vals[field.key] = field.default ?? "";
  }
  formValues.value = vals;
  extraParams.value = [];
  rawJsonParams.value = "{}";
};

const copyParams = () => {
  let payload: Record<string, any>;
  try {
    payload = buildPayload();
  } catch {
    return;
  }
  navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  toast.add({ severity: "info", summary: "Copied", detail: "Params copied to clipboard", life: 2000 });
};

const copyResponse = () => {
  navigator.clipboard.writeText(formattedResponse.value);
  toast.add({ severity: "info", summary: "Copied", detail: "Response copied to clipboard", life: 2000 });
};

// ── Resize handle ─────────────────────────────────────────────────────────────
const startDrag = (e: MouseEvent) => {
  isDragging.value = true;
  dragStartY = e.clientY;
  dragStartH = paramsHeight.value;
  window.addEventListener("mousemove", onDrag);
  window.addEventListener("mouseup", stopDrag);
};

const onDrag = (e: MouseEvent) => {
  const delta = e.clientY - dragStartY;
  const containerH = splitRef.value?.clientHeight ?? 600;
  paramsHeight.value = Math.min(Math.max(80, dragStartH + delta), containerH - 120);
};

const stopDrag = () => {
  isDragging.value = false;
  window.removeEventListener("mousemove", onDrag);
  window.removeEventListener("mouseup", stopDrag);
};

onBeforeUnmount(() => {
  window.removeEventListener("mousemove", onDrag);
  window.removeEventListener("mouseup", stopDrag);
});
</script>

<style scoped>
/* ── Layout ── */
.main-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--p-slate-50);
}

/* ── Sidebar ── */
.collapsed-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: none;
  background: transparent;
  border-radius: 0.375rem;
  cursor: pointer;
  color: var(--p-slate-400);
  font-size: 1rem;
}
.collapsed-icon-btn:hover {
  background: var(--p-slate-100);
  color: var(--p-slate-700);
}

.sb-search {
  position: relative;
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid var(--p-slate-100);
  flex-shrink: 0;
}
.sb-search-icon {
  position: absolute;
  left: 1.1rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.7rem;
  color: var(--p-slate-400);
}
.sb-search-input {
  width: 100%;
  padding: 0.3rem 1.8rem 0.3rem 1.8rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.375rem;
  background: white;
  font-size: 0.75rem;
  color: var(--p-slate-700);
  outline: none;
}
.sb-search-input:focus { border-color: var(--p-blue-300); }
.sb-search-clear {
  position: absolute;
  right: 1.1rem;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: none;
  cursor: pointer;
  color: var(--p-slate-400);
  font-size: 0.65rem;
  padding: 0.1rem;
}
.sb-search-clear:hover { color: var(--p-slate-700); }

.sb-groups {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 0.25rem;
}
.sb-group-header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.75rem 0.2rem;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--p-slate-400);
  flex-shrink: 0;
}
.sb-group-header i { font-size: 0.65rem; }
.sb-group-count {
  margin-left: auto;
  background: var(--p-slate-100);
  color: var(--p-slate-500);
  padding: 0.05rem 0.35rem;
  border-radius: 0.75rem;
  font-size: 0.6rem;
  font-weight: 600;
}
.sb-clear-btn {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--p-slate-400);
  font-size: 0.65rem;
  padding: 0.15rem;
  border-radius: 0.2rem;
}
.sb-clear-btn:hover { background: var(--p-red-50); color: var(--p-red-500); }

.sb-endpoint {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0.3rem 0.75rem 0.3rem 1.25rem;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
  gap: 0.25rem;
}
.sb-endpoint:hover { background: var(--p-slate-100); }
.sb-endpoint--active { background: var(--p-blue-50); }
.sb-endpoint--active .sb-endpoint-name { color: var(--p-blue-600); font-weight: 600; }
.sb-endpoint-name {
  font-size: 0.72rem;
  font-family: "JetBrains Mono", monospace;
  color: var(--p-slate-700);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sb-endpoint--destructive .sb-endpoint-name { color: var(--p-orange-700); }
.sb-destructive-badge {
  font-size: 0.6rem;
  font-weight: 800;
  color: white;
  background: var(--p-orange-400);
  border-radius: 0.2rem;
  padding: 0 0.2rem;
  flex-shrink: 0;
}

.sb-empty {
  padding: 0.75rem 1rem;
  font-size: 0.75rem;
  color: var(--p-slate-400);
  text-align: center;
}

.sb-divider {
  height: 1px;
  background: var(--p-slate-200);
  margin: 0.25rem 0;
  flex-shrink: 0;
}

.sb-history { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.sb-history-list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.sb-history-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0;
  background: transparent;
}
.sb-history-replay {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  flex: 1;
  padding: 0.28rem 0.25rem 0.28rem 0.75rem;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-size: 0.7rem;
}
.sb-history-delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.45rem;
  min-width: 1.45rem;
  border: none;
  background: transparent;
  color: var(--p-slate-400);
  cursor: pointer;
  font-size: 0.65rem;
}
.sb-history-item:hover,
.sb-history-replay:hover,
.sb-history-delete:hover { background: var(--p-slate-100); }
.sb-history-delete:hover { color: var(--p-red-500); }
.sb-history-status { font-weight: 700; font-size: 0.65rem; flex-shrink: 0; }
.status-ok { color: var(--p-green-500); }
.status-error { color: var(--p-red-500); }
.sb-history-route {
  flex: 1;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.65rem;
  color: var(--p-slate-600);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sb-history-dur {
  font-size: 0.6rem;
  color: var(--p-slate-400);
  flex-shrink: 0;
}

/* ── Empty state ── */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
  color: var(--p-slate-400);
}
.empty-icon {
  font-size: 3rem;
  color: var(--p-slate-300);
  margin-bottom: 0.5rem;
}
.empty-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--p-slate-600);
  margin: 0;
}
.empty-sub {
  font-size: 0.8rem;
  color: var(--p-slate-400);
  margin: 0;
  text-align: center;
  line-height: 1.5;
}
.quick-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 0.75rem;
}
.quick-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.875rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.375rem;
  background: white;
  font-size: 0.75rem;
  font-family: "JetBrains Mono", monospace;
  color: var(--p-slate-700);
  cursor: pointer;
  transition: all 0.15s;
}
.quick-btn:hover {
  border-color: var(--p-blue-300);
  background: var(--p-blue-50);
  color: var(--p-blue-700);
}
.quick-btn i { font-size: 0.7rem; }

/* ── Endpoint header ── */
.endpoint-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 1rem;
  border-bottom: 1px solid var(--p-slate-200);
  background: white;
  flex-shrink: 0;
  gap: 0.5rem;
}
.endpoint-header-left {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 1;
  min-width: 0;
}
.endpoint-header-right {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.endpoint-route-badge {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--p-slate-800);
  background: var(--p-slate-100);
  padding: 0.2rem 0.5rem;
  border-radius: 0.25rem;
  border: 1px solid var(--p-slate-200);
  white-space: nowrap;
}
.destructive-warning {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
  color: var(--p-orange-600);
  font-weight: 600;
}
.destructive-warning i { font-size: 0.7rem; }

.endpoint-desc {
  padding: 0.4rem 1rem;
  font-size: 0.78rem;
  color: var(--p-slate-500);
  background: var(--p-slate-50);
  border-bottom: 1px solid var(--p-slate-100);
  flex-shrink: 0;
  line-height: 1.5;
}

/* ── Shared btn styles ── */
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  background: transparent;
  border-radius: 0.25rem;
  cursor: pointer;
  color: var(--p-slate-400);
  font-size: 0.75rem;
  transition: all 0.1s;
}
.icon-btn:hover {
  background: var(--p-slate-100);
  color: var(--p-slate-700);
}
.fmt-btn {
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.25rem;
  background: white;
  font-size: 0.7rem;
  color: var(--p-slate-500);
  cursor: pointer;
  transition: all 0.1s;
}
.fmt-btn:hover { background: var(--p-slate-50); color: var(--p-slate-700); }
.fmt-btn.active {
  background: var(--p-slate-700);
  color: white;
  border-color: var(--p-slate-700);
}

.send-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.875rem;
  border: none;
  border-radius: 0.375rem;
  background: var(--p-blue-600);
  color: white;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.1s;
  flex-shrink: 0;
}
.send-btn:hover:not(:disabled) { background: var(--p-blue-700); }
.send-btn:disabled { background: var(--p-slate-300); cursor: not-allowed; }
.send-btn i { font-size: 0.75rem; }

/* ── Split container ── */
.split-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

/* ── Panes ── */
.pane {
  display: flex;
  flex-direction: column;
  background: white;
  min-height: 0;
  overflow: hidden;
}
.pane-params { border-bottom: 1px solid var(--p-slate-200); flex-shrink: 0; }
.pane-response { flex: 1; }

.pane-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--p-slate-100);
  background: var(--p-slate-50);
  flex-shrink: 0;
}
.pane-title {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--p-slate-600);
  letter-spacing: 0.03em;
  text-transform: uppercase;
  flex: 1;
}
.pane-title i { font-size: 0.68rem; }
.pane-header-actions { display: flex; gap: 0.25rem; align-items: center; }

.response-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-right: 0.25rem;
}
.status-pill {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.1rem 0.45rem;
  border-radius: 0.75rem;
}
.status-pill--ok { background: var(--p-green-100); color: var(--p-green-700); }
.status-pill--error { background: var(--p-red-100); color: var(--p-red-700); }
.duration-pill {
  font-size: 0.65rem;
  color: var(--p-slate-400);
  font-family: "JetBrains Mono", monospace;
}

/* ── Resize handle ── */
.resize-handle {
  height: 5px;
  background: var(--p-slate-100);
  cursor: row-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.1s;
}
.resize-handle:hover,
.resize-handle.dragging { background: var(--p-blue-200); }
.resize-handle-dots {
  width: 1.5rem;
  height: 3px;
  border-top: 1px solid var(--p-slate-300);
  border-bottom: 1px solid var(--p-slate-300);
}

/* ── Form params ── */
.form-params {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
}
.no-params {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.78rem;
  color: var(--p-slate-400);
  padding: 0.5rem 0;
}
.no-params i { color: var(--p-green-400); }

.form-row {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.form-label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.72rem;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
  color: var(--p-slate-700);
}
.required-star { color: var(--p-red-500); }
.type-badge {
  font-size: 0.6rem;
  font-weight: 600;
  padding: 0.05rem 0.3rem;
  border-radius: 0.2rem;
  background: var(--p-indigo-50);
  color: var(--p-indigo-500);
  border: 1px solid var(--p-indigo-100);
}
.form-input {
  width: 100%;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.3rem;
  font-size: 0.78rem;
  color: var(--p-slate-800);
  background: white;
  outline: none;
  font-family: "JetBrains Mono", monospace;
}
.form-input:focus { border-color: var(--p-blue-400); }
.form-textarea {
  width: 100%;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.3rem;
  font-size: 0.75rem;
  color: var(--p-slate-800);
  background: white;
  outline: none;
  resize: vertical;
  font-family: "JetBrains Mono", monospace;
  line-height: 1.5;
  min-height: 80px;
}
.form-textarea:focus { border-color: var(--p-blue-400); }
.form-hint { font-size: 0.67rem; color: var(--p-slate-400); line-height: 1.3; }

.extra-params-section {
  margin-top: 0.25rem;
  border-top: 1px solid var(--p-slate-100);
  padding-top: 0.4rem;
}
.extra-params-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--p-slate-400);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.add-param-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.15rem 0.4rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.25rem;
  background: white;
  font-size: 0.65rem;
  color: var(--p-slate-500);
  cursor: pointer;
}
.add-param-btn:hover { background: var(--p-slate-50); color: var(--p-slate-700); }
.add-param-btn i { font-size: 0.6rem; }

.extra-param-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 0.35rem;
  margin-bottom: 0.35rem;
}
.extra-key,
.extra-value {
  padding: 0.28rem 0.45rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-family: "JetBrains Mono", monospace;
  color: var(--p-slate-700);
  background: white;
  outline: none;
}
.extra-key:focus, .extra-value:focus { border-color: var(--p-blue-400); }
.remove-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--p-slate-300);
  font-size: 0.65rem;
  border-radius: 0.2rem;
}
.remove-btn:hover { color: var(--p-red-400); background: var(--p-red-50); }

/* ── JSON params ── */
.json-params {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* ── Response pane ── */
.response-loading,
.response-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: var(--p-slate-400);
  font-size: 0.8rem;
}
.response-loading i { font-size: 1.5rem; color: var(--p-blue-400); }
.response-empty-icon { font-size: 2rem; color: var(--p-slate-300); }

.response-error-block {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 0.75rem 1rem;
  gap: 0.5rem;
  overflow: auto;
}
.response-error-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--p-red-600);
}
.response-error-header i { font-size: 0.85rem; }
.response-error-message {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.78rem;
  color: var(--p-red-700);
  background: var(--p-red-50);
  border: 1px solid var(--p-red-100);
  border-radius: 0.375rem;
  padding: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}

.response-ok {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.response-editor { flex: 1; min-height: 0; }
</style>
