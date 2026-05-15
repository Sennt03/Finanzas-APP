import { ChangeDetectionStrategy, Component, inject, Renderer2, signal } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '@services/auth.service';
import { sharedImports } from '@shared/shared.imports';
import toastr from '@shared/utils/toastr';

@Component({
  selector: 'app-login',
  imports: [...sharedImports, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginComponent {
  private renderer = inject(Renderer2);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private formBuilder = inject(FormBuilder);
  private authService = inject(AuthService);

  form: FormGroup;
  maskLoad = signal(false);

  constructor() {
    this.form = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]]
    });
  }

  togglePasswordVisibility() {
    const passwordInput = this.renderer.selectRootElement('#password-input');
    const passwordIcon = this.renderer.selectRootElement('.icon-password');
    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    const remove = passwordInput.getAttribute('type') === 'password' ? 'fa-eye' : 'fa-eye-slash';
    const add = passwordInput.getAttribute('type') === 'password' ? 'fa-eye-slash' : 'fa-eye';
    this.renderer.setAttribute(passwordInput, 'type', type);
    this.renderer.removeClass(passwordIcon, remove);
    this.renderer.addClass(passwordIcon, add);
  }

  signup() {
    this.router.navigate(['../register'], { relativeTo: this.route });
  }

  hasError(field: string, error: string) {
    return (this.form.get(field) as AbstractControl).hasError(error);
  }

  haveErrors(field: string) {
    const control = this.form.get(field) as AbstractControl;
    return control.touched && control.invalid;
  }

  login() {
    if (!this.form.valid) {
      this.form.markAllAsTouched();
      return;
    }

    this.maskLoad.set(true);
    this.authService.login(this.form.value).subscribe({
      next: (res) => {
        toastr.success('Bienvenido!', '');
        this.maskLoad.set(false);
        this.authService.saveAuth(res);
        this.form.markAsUntouched();
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.maskLoad.set(false);
        toastr.setOption('timeOut', 3000);
        if (window.innerWidth < 768) toastr.setOption('positionClass', 'toast-top-center');
        toastr.error(err.error?.message ?? 'Error', 'Login fallido');
        toastr.setDefaultsOptions();
      }
    });
  }
}
