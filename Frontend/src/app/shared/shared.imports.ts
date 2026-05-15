import { CommonModule } from '@angular/common';
import { LoadingComponent } from './components/loading/loading.component';
import { materialImports } from './material/material.imports';

export const sharedImports = [
    CommonModule,
    ...materialImports,
    LoadingComponent
];

export { LoadingComponent };
