import { ChangeDetectionStrategy, Component, inject, Renderer2, signal } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '@services/auth.service';
import { sharedImports } from '@shared/shared.imports';
import { MyValidators } from '@shared/utils/myValidators';
import toastr from '@shared/utils/toastr';

@Component({
  selector: 'app-register',
  imports: [...sharedImports, ReactiveFormsModule],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RegisterComponent {
  private renderer = inject(Renderer2);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private formBuilder = inject(FormBuilder);
  private authService = inject(AuthService);

  form: FormGroup;
  maskLoad = signal(false);

  constructor() {
    this.form = this.formBuilder.group({
      username: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.required, Validators.email], MyValidators.validateEmail(this.authService)],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]]
    }, {
      validators: MyValidators.matchPasswords
    });
  }

  togglePasswordVisibility(prefix = '') {
    const passId = '#' + prefix + 'password-input';
    const iconId = '.' + prefix + 'icon-password';
    const passwordInput = this.renderer.selectRootElement(passId);
    const passwordIcon = this.renderer.selectRootElement(iconId);
    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    const remove = passwordInput.getAttribute('type') === 'password' ? 'fa-eye' : 'fa-eye-slash';
    const add = passwordInput.getAttribute('type') === 'password' ? 'fa-eye-slash' : 'fa-eye';
    this.renderer.setAttribute(passwordInput, 'type', type);
    this.renderer.removeClass(passwordIcon, remove);
    this.renderer.addClass(passwordIcon, add);
  }

  signin() {
    this.router.navigate(['../login'], { relativeTo: this.route });
  }

  hasError(field: string, error: string) {
    return (this.form.get(field) as AbstractControl).hasError(error);
  }

  haveErrors(field: string) {
    const control = this.form.get(field) as AbstractControl;
    return control.touched && control.invalid;
  }

  register() {
    if (!this.form.valid) {
      this.form.markAllAsTouched();
      return;
    }

    this.maskLoad.set(true);
    const { username, email, password } = this.form.value;
    this.authService.register({ username, email, password }).subscribe({
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
        toastr.error(err.error?.message ?? 'Error', 'Registro fallido');
        toastr.setDefaultsOptions();
      }
    });
  }
}
