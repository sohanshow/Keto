import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-void flex items-center justify-center p-4">
      <SignUp 
        appearance={{
          elements: {
            rootBox: 'mx-auto',
            card: 'bg-charcoal border border-white/10',
            headerTitle: 'text-white',
            headerSubtitle: 'text-white/60',
            socialButtonsBlockButton: 'bg-white/5 border-white/10 text-white hover:bg-white/10',
            formButtonPrimary: 'bg-gold text-void hover:bg-amber',
            formFieldInput: 'bg-white/5 border-white/10 text-white',
            formFieldLabel: 'text-white/80',
            footerActionLink: 'text-gold hover:text-amber',
            identityPreviewText: 'text-white',
            identityPreviewEditButton: 'text-gold hover:text-amber',
          }
        }}
      />
    </div>
  );
}
