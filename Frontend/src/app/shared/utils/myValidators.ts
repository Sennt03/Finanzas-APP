import { AbstractControl } from '@angular/forms';
import { map } from 'rxjs';
import { AuthService } from '@services/auth.service';

export class MyValidators {

  static matchPasswords(control: AbstractControl) {
    const password = (control.get('password') as AbstractControl).value;
    const confirmPassword = (control.get('confirmPassword') as AbstractControl).value;
    if (password !== confirmPassword) {
      return { match_password: true };
    }
    return null;
  }

  static validateUsername(service: AuthService) {
    return (control: AbstractControl) => {
      const value = control.value;
      return validateAvaible(service, value, 'username');
    };
  }

  static validateEmail(service: AuthService) {
    return (control: AbstractControl) => {
      const value = control.value;
      return validateAvaible(service, value, 'email');
    };
  }
}

function validateAvaible(service: AuthService, value: any, field: 'email' | 'username') {
  return service.validateAvaible(value, field).pipe(
    map((response) => {
      const isAvailable = response.isAvailable;
      if (!isAvailable) {
        return { not_available: true };
      }
      return null;
    })
  );
}
