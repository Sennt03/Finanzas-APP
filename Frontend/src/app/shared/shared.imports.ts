import { LoadingComponent } from './components/loading/loading.component';
import { materialImports } from './material/material.imports';

export const sharedImports = [
    ...materialImports,
    LoadingComponent
];

export { LoadingComponent };
