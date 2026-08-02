"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const source = node_fs_1.default.readFileSync(node_path_1.default.join(process.cwd(), 'app/components/sales/opportunity-network-workspace.tsx'), 'utf8');
strict_1.default.match(source, /const \[expanded, setExpanded\] = useState\(false\)/, 'Opportunity & network must be collapsed when a lead first opens');
strict_1.default.match(source, /aria-expanded=\{expanded\}/, 'The workspace toggle must expose its state accessibly');
strict_1.default.match(source, /\{expanded \? <>\s*<div/, 'The full workspace must only render after the operator expands it');
