/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!../notebook';
import * as DOM from 'vs/base/browser/dom';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { deepClone } from 'vs/base/common/objects';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IListRenderer, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { getZoomLevel } from 'vs/base/browser/browser';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { Action } from 'vs/base/common/actions';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { StatefullMarkdownCell } from 'vs/workbench/contrib/notebook/browser/renderers/markdownCell';
import { CellViewModel } from './cellViewModel';
import { CodeCell } from 'vs/workbench/contrib/notebook/browser/renderers/codeCell';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { CellRenderTemplate, INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';

export class NotebookCellListDelegate implements IListVirtualDelegate<CellViewModel> {
	private _lineHeight: number;
	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		const editorOptions = this.configurationService.getValue<IEditorOptions>('editor');
		this._lineHeight = BareFontInfo.createFromRawSettings(editorOptions, getZoomLevel()).lineHeight;
	}

	getHeight(element: CellViewModel): number {
		return element.getHeight(this._lineHeight);
	}

	hasDynamicHeight(element: CellViewModel): boolean {
		return element.hasDynamicHeight();
	}

	getDynamicHeight(element: CellViewModel) {
		return element.dynamicHeight || 0;
	}

	getTemplateId(element: CellViewModel): string {
		if (element.cellType === 'markdown') {
			return MarkdownCellRenderer.TEMPLATE_ID;
		} else {
			return CodeCellRenderer.TEMPLATE_ID;
		}
	}
}

class AbstractCellRenderer {
	protected editorOptions: IEditorOptions;

	constructor(
		protected handler: INotebookEditor,
		private contextMenuService: IContextMenuService,
		private configurationService: IConfigurationService,
		language: string
	) {
		const editorOptions = deepClone(this.configurationService.getValue<IEditorOptions>('editor', { overrideIdentifier: language }));
		this.editorOptions = {
			...editorOptions,
			scrollBeyondLastLine: false,
			scrollbar: {
				verticalScrollbarSize: 14,
				horizontal: 'auto',
				useShadows: true,
				verticalHasArrows: false,
				horizontalHasArrows: false,
				alwaysConsumeMouseWheel: false
			},
			overviewRulerLanes: 3,
			fixedOverflowWidgets: false,
			lineNumbersMinChars: 1,
			minimap: { enabled: false },
		};
	}

	showContextMenu(listIndex: number | undefined, element: CellViewModel, x: number, y: number) {
		const actions: Action[] = [];
		const insertAbove = new Action(
			'workbench.notebook.code.insertCellAbove',
			'Insert Code Cell Above',
			undefined,
			true,
			async () => {
				await this.handler.insertEmptyNotebookCell(listIndex, element, 'code', 'above');
			}
		);
		actions.push(insertAbove);

		const insertBelow = new Action(
			'workbench.notebook.code.insertCellBelow',
			'Insert Code Cell Below',
			undefined,
			true,
			async () => {
				await this.handler.insertEmptyNotebookCell(listIndex, element, 'code', 'below');
			}
		);
		actions.push(insertBelow);

		const insertMarkdownAbove = new Action(
			'workbench.notebook.markdown.insertCellAbove',
			'Insert Markdown Cell Above',
			undefined,
			true,
			async () => {
				await this.handler.insertEmptyNotebookCell(listIndex, element, 'markdown', 'above');
			}
		);
		actions.push(insertMarkdownAbove);

		const insertMarkdownBelow = new Action(
			'workbench.notebook.markdown.insertCellBelow',
			'Insert Markdown Cell Below',
			undefined,
			true,
			async () => {
				await this.handler.insertEmptyNotebookCell(listIndex, element, 'markdown', 'below');
			}
		);
		actions.push(insertMarkdownBelow);

		if (element.cellType === 'markdown') {
			const editAction = new Action(
				'workbench.notebook.editCell',
				'Edit Cell',
				undefined,
				true,
				async () => {
					this.handler.editNotebookCell(listIndex, element);
				}
			);

			actions.push(editAction);

			const saveAction = new Action(
				'workbench.notebook.saveCell',
				'Save Cell',
				undefined,
				true,
				async () => {
					this.handler.saveNotebookCell(listIndex, element);
				}
			);

			actions.push(saveAction);
		}

		const deleteCell = new Action(
			'workbench.notebook.deleteCell',
			'Delete Cell',
			undefined,
			true,
			async () => {
				this.handler.deleteNotebookCell(listIndex, element);
			}
		);

		actions.push(deleteCell);

		this.contextMenuService.showContextMenu({
			getAnchor: () => {
				return {
					x,
					y
				};
			},
			getActions: () => {
				return actions;
			},
			autoSelectFirstItem: true
		});
	}
}

export class MarkdownCellRenderer extends AbstractCellRenderer implements IListRenderer<CellViewModel, CellRenderTemplate> {
	static readonly TEMPLATE_ID = 'markdown_cell';
	private disposables: Map<CellViewModel, DisposableStore> = new Map();

	constructor(
		handler: INotebookEditor,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextMenuService contextMenuService: IContextMenuService
	) {
		super(handler, contextMenuService, configurationService, 'markdown');
	}

	get templateId() {
		return MarkdownCellRenderer.TEMPLATE_ID;
	}

	renderTemplate(container: HTMLElement): CellRenderTemplate {
		const codeInnerContent = document.createElement('div');
		DOM.addClasses(codeInnerContent, 'cell', 'code');
		codeInnerContent.style.display = 'none';

		container.appendChild(codeInnerContent);

		const innerContent = document.createElement('div');
		DOM.addClasses(innerContent, 'cell', 'markdown');
		container.appendChild(innerContent);

		const action = document.createElement('div');
		DOM.addClasses(action, 'menu', 'codicon-settings-gear', 'codicon');
		container.appendChild(action);

		const template = {
			container: container,
			cellContainer: innerContent,
			menuContainer: action,
			editingContainer: codeInnerContent
		};

		return template;
	}

	renderElement(element: CellViewModel, index: number, templateData: CellRenderTemplate, height: number | undefined): void {
		templateData.editingContainer!.style.display = 'none';
		templateData.cellContainer.innerHTML = '';
		let renderedHTML = element.getHTML();
		if (renderedHTML) {
			templateData.cellContainer.appendChild(renderedHTML);
		}

		if (height) {
			this.disposables.get(element)?.clear();
			if (!this.disposables.has(element)) {
				this.disposables.set(element, new DisposableStore());
			}
			let elementDisposable = this.disposables.get(element);

			elementDisposable!.add(DOM.addStandardDisposableListener(templateData.menuContainer!, 'mousedown', e => {
				const { top, height } = DOM.getDomNodePagePosition(templateData.menuContainer!);
				e.preventDefault();

				const listIndexAttr = templateData.menuContainer?.parentElement?.getAttribute('data-index');
				const listIndex = listIndexAttr ? Number(listIndexAttr) : undefined;
				this.showContextMenu(listIndex, element, e.posx, top + height);
			}));

			elementDisposable!.add(new StatefullMarkdownCell(this.handler, element, templateData, this.editorOptions, this.instantiationService));
		}
	}

	disposeTemplate(templateData: CellRenderTemplate): void {
		// throw nerendererw Error('Method not implemented.');

	}

	disposeElement(element: CellViewModel, index: number, templateData: CellRenderTemplate, height: number | undefined): void {
		if (height) {
			this.disposables.get(element)?.clear();
		}
	}
}

export class CodeCellRenderer extends AbstractCellRenderer implements IListRenderer<CellViewModel, CellRenderTemplate> {
	static readonly TEMPLATE_ID = 'code_cell';
	private disposables: Map<CellViewModel, DisposableStore> = new Map();

	constructor(
		protected handler: INotebookEditor,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IThemeService private readonly themeService: IThemeService,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService
	) {
		super(handler, contextMenuService, configurationService, 'python');
	}

	get templateId() {
		return CodeCellRenderer.TEMPLATE_ID;
	}

	renderTemplate(container: HTMLElement): CellRenderTemplate {
		const innerContent = document.createElement('div');
		DOM.addClasses(innerContent, 'cell', 'code');
		container.appendChild(innerContent);
		const editor = this.instantiationService.createInstance(CodeEditorWidget, innerContent, {
			...this.editorOptions,
			dimension: {
				width: 0,
				height: 0
			}
		}, {});
		const action = document.createElement('div');
		DOM.addClasses(action, 'menu', 'codicon-settings-gear', 'codicon');
		container.appendChild(action);

		const outputContainer = document.createElement('div');
		DOM.addClasses(outputContainer, 'output');
		container.appendChild(outputContainer);

		let tempalte = {
			container: container,
			cellContainer: innerContent,
			menuContainer: action,
			outputContainer: outputContainer,
			editor
		};

		return tempalte;
	}

	renderElement(element: CellViewModel, index: number, templateData: CellRenderTemplate, height: number | undefined): void {
		if (templateData.outputContainer) {
			templateData.outputContainer!.innerHTML = '';
		}

		this.disposables.get(element)?.clear();
		if (!this.disposables.has(element)) {
			this.disposables.set(element, new DisposableStore());
		}

		let elementDisposable = this.disposables.get(element);

		elementDisposable?.add(DOM.addStandardDisposableListener(templateData.menuContainer!, 'mousedown', e => {
			let { top, height } = DOM.getDomNodePagePosition(templateData.menuContainer!);
			e.preventDefault();

			const listIndexAttr = templateData.menuContainer?.parentElement?.getAttribute('data-index');
			const listIndex = listIndexAttr ? Number(listIndexAttr) : undefined;

			this.showContextMenu(listIndex, element, e.posx, top + height);
		}));

		elementDisposable?.add(new CodeCell(this.handler, element, templateData, this.themeService, this.instantiationService, this.modelService, this.modeService, height));
	}

	disposeTemplate(templateData: CellRenderTemplate): void {
	}

	disposeElement(element: CellViewModel, index: number, templateData: CellRenderTemplate, height: number | undefined): void {
		this.disposables.get(element)?.clear();
	}
}
